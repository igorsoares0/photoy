#include "edit/decontaminate.h"

#include <algorithm>
#include <cmath>

namespace photoy {
namespace {

/// Cells across the long side. The background is smooth; this is plenty.
constexpr int kGridLongSide = 192;
/// Below this weight a cell has seen no background and needs filling in.
constexpr float kKnown = 1.0e-4f;
/// Samples each grid cell wants before the stride is allowed to skip pixels.
constexpr double kSamplesPerCell = 16.0;

/// How much a pixel counts as background. Full below a quarter, none above half.
float BackgroundWeight(float coverage) noexcept {
  return std::clamp((0.5f - coverage) * 4.0f, 0.0f, 1.0f);
}

/// Spreads known cells into unknown ones until the grid is filled.
void FloodFill(std::vector<float>& rgb, std::vector<float>& weight, int width, int height) {
  std::vector<float> next_rgb(rgb.size());
  std::vector<float> next_weight(weight.size());
  const int limit = width + height;

  for (int pass = 0; pass < limit; ++pass) {
    bool missing = false;
    next_rgb = rgb;
    next_weight = weight;

    for (int y = 0; y < height; ++y) {
      for (int x = 0; x < width; ++x) {
        const std::size_t cell = static_cast<std::size_t>(y) * width + x;
        if (weight[cell] > kKnown) continue;

        float sum[3] = {0.0f, 0.0f, 0.0f};
        float count = 0.0f;
        for (int dy = -1; dy <= 1; ++dy) {
          for (int dx = -1; dx <= 1; ++dx) {
            const int nx = x + dx;
            const int ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const std::size_t neighbour = static_cast<std::size_t>(ny) * width + nx;
            if (weight[neighbour] <= kKnown) continue;
            for (int c = 0; c < 3; ++c) sum[c] += rgb[neighbour * 3 + c];
            count += 1.0f;
          }
        }
        if (count == 0.0f) {
          missing = true;
          continue;
        }
        for (int c = 0; c < 3; ++c) next_rgb[cell * 3 + c] = sum[c] / count;
        next_weight[cell] = 1.0f;
      }
    }
    rgb.swap(next_rgb);
    weight.swap(next_weight);
    if (!missing) return;
  }
}

/// A 3x3 box blur, so the filled grid carries no seams from the fill.
void Smooth(std::vector<float>& rgb, int width, int height) {
  std::vector<float> out(rgb.size());
  for (int y = 0; y < height; ++y) {
    for (int x = 0; x < width; ++x) {
      float sum[3] = {0.0f, 0.0f, 0.0f};
      float count = 0.0f;
      for (int dy = -1; dy <= 1; ++dy) {
        for (int dx = -1; dx <= 1; ++dx) {
          const int nx = std::clamp(x + dx, 0, width - 1);
          const int ny = std::clamp(y + dy, 0, height - 1);
          const std::size_t neighbour = (static_cast<std::size_t>(ny) * width + nx) * 3;
          for (int c = 0; c < 3; ++c) sum[c] += rgb[neighbour + c];
          count += 1.0f;
        }
      }
      const std::size_t cell = (static_cast<std::size_t>(y) * width + x) * 3;
      for (int c = 0; c < 3; ++c) out[cell + c] = sum[c] / count;
    }
  }
  rgb.swap(out);
}

}  // namespace

void BackgroundEstimate::SampleAt(int x, int y, float out[3]) const noexcept {
  const float gx = (static_cast<float>(x) + 0.5f) * scale_x - 0.5f;
  const float gy = (static_cast<float>(y) + 0.5f) * scale_y - 0.5f;
  const int x0 = std::clamp(static_cast<int>(std::floor(gx)), 0, width - 1);
  const int y0 = std::clamp(static_cast<int>(std::floor(gy)), 0, height - 1);
  const int x1 = std::min(x0 + 1, width - 1);
  const int y1 = std::min(y0 + 1, height - 1);
  const float fx = std::clamp(gx - static_cast<float>(x0), 0.0f, 1.0f);
  const float fy = std::clamp(gy - static_cast<float>(y0), 0.0f, 1.0f);

  const std::size_t row0 = static_cast<std::size_t>(y0) * width;
  const std::size_t row1 = static_cast<std::size_t>(y1) * width;
  for (int c = 0; c < 3; ++c) {
    const float top = rgb[(row0 + x0) * 3 + c] +
                      (rgb[(row0 + x1) * 3 + c] - rgb[(row0 + x0) * 3 + c]) * fx;
    const float bottom = rgb[(row1 + x0) * 3 + c] +
                         (rgb[(row1 + x1) * 3 + c] - rgb[(row1 + x0) * 3 + c]) * fx;
    out[c] = top + (bottom - top) * fy;
  }
}

BackgroundEstimatePtr EstimateBackground(const Image16& image, const CompiledMask& mask) {
  if (image.width() <= 0 || image.height() <= 0) return nullptr;

  auto estimate = std::make_shared<BackgroundEstimate>();
  const int longest = std::max(image.width(), image.height());
  const double grid = std::min(static_cast<double>(kGridLongSide), static_cast<double>(longest));
  estimate->width = std::max(1, static_cast<int>(std::lround(image.width() * grid / longest)));
  estimate->height = std::max(1, static_cast<int>(std::lround(image.height() * grid / longest)));
  estimate->scale_x = static_cast<float>(estimate->width) / static_cast<float>(image.width());
  estimate->scale_y = static_cast<float>(estimate->height) / static_cast<float>(image.height());

  const std::size_t cells = static_cast<std::size_t>(estimate->width) * estimate->height;
  estimate->rgb.assign(cells * 3, 0.0f);
  std::vector<float> weight(cells, 0.0f);

  // The grid is coarse, so reading every pixel to fill it is waste: a stride
  // that leaves roughly kSamplesPerCell samples in each cell says the same
  // thing about a slowly varying background and costs a fraction as much. On a
  // preview the stride works out at 1 and nothing is skipped.
  const double per_cell = static_cast<double>(image.width()) * image.height() /
                          (static_cast<double>(cells) * kSamplesPerCell);
  const int step = std::max(1, static_cast<int>(std::sqrt(std::max(1.0, per_cell))));

  constexpr float kFromSample = 1.0f / 65535.0f;
  for (int y = 0; y < image.height(); y += step) {
    const int gy = std::min(static_cast<int>(y * estimate->scale_y), estimate->height - 1);
    const std::uint16_t* row = image.Row(y);
    for (int x = 0; x < image.width(); x += step) {
      const float w = BackgroundWeight(mask.At(x, y));
      if (w <= 0.0f) continue;
      const int gx = std::min(static_cast<int>(x * estimate->scale_x), estimate->width - 1);
      const std::size_t cell = static_cast<std::size_t>(gy) * estimate->width + gx;
      const std::size_t index = static_cast<std::size_t>(x) * kChannels;
      for (int c = 0; c < 3; ++c) estimate->rgb[cell * 3 + c] += row[index + c] * kFromSample * w;
      weight[cell] += w;
    }
  }

  bool any = false;
  for (std::size_t cell = 0; cell < cells; ++cell) {
    if (weight[cell] <= kKnown) continue;
    any = true;
    for (int c = 0; c < 3; ++c) estimate->rgb[cell * 3 + c] /= weight[cell];
  }
  // A mask that keeps everything has no background to learn from, and there is
  // nothing honest to unmix against.
  if (!any) return nullptr;

  FloodFill(estimate->rgb, weight, estimate->width, estimate->height);
  Smooth(estimate->rgb, estimate->width, estimate->height);
  return estimate;
}

}  // namespace photoy
