#include "image/resample.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <vector>

#include "core/error.h"

namespace photoy {
namespace {

constexpr double kMaxSample = static_cast<double>(Image16::kMaxValue);

std::uint16_t ClampToSample(double value) noexcept {
  if (value <= 0.0) return 0;
  if (value >= kMaxSample) return Image16::kMaxValue;
  return static_cast<std::uint16_t>(value + 0.5);
}

}  // namespace

FitResult FitInside(int source_width, int source_height, int max_width, int max_height) noexcept {
  FitResult fit;
  if (source_width <= 0 || source_height <= 0) return fit;
  if (max_width <= 0 || max_height <= 0) {
    fit.width = source_width;
    fit.height = source_height;
    fit.scale = 1.0;
    return fit;
  }

  const double scale = std::min({1.0,
                                 static_cast<double>(max_width) / source_width,
                                 static_cast<double>(max_height) / source_height});
  fit.scale = scale;
  fit.width = std::max(1, static_cast<int>(source_width * scale + 0.5));
  fit.height = std::max(1, static_cast<int>(source_height * scale + 0.5));
  return fit;
}

Image16 DownscaleBox(const Image16& source, const Rect& region, int target_width,
                     int target_height, const CancellationTokenPtr& token) {
  if (target_width <= 0 || target_height <= 0) {
    throw EngineException(error_code::kInternalError, "Invalid resample target",
                          std::to_string(target_width) + "x" + std::to_string(target_height));
  }
  const Rect area = Intersect(region, Rect{0, 0, source.width(), source.height()});
  if (area.empty()) {
    throw EngineException(error_code::kInvalidRequest, "Nothing left to render",
                          "the crop region falls outside the image");
  }

  Image16 result = Image16::Create(target_width, target_height);

  // Precompute the source span for every target column so the inner loop stays
  // free of division.
  std::vector<int> column_start(static_cast<std::size_t>(target_width) + 1);
  for (int x = 0; x <= target_width; ++x) {
    column_start[static_cast<std::size_t>(x)] =
        area.x + static_cast<int>(static_cast<long long>(x) * area.width / target_width);
  }

  for (int y = 0; y < target_height; ++y) {
    // Checked per output row: fine enough that a superseded render stops within
    // a frame, coarse enough not to touch the atomic per pixel.
    if (token->cancelled()) {
      throw EngineException(error_code::kCancelled, "Render cancelled", "superseded");
    }

    const int row_begin =
        area.y + static_cast<int>(static_cast<long long>(y) * area.height / target_height);
    int row_end =
        area.y + static_cast<int>(static_cast<long long>(y + 1) * area.height / target_height);
    if (row_end <= row_begin) row_end = row_begin + 1;

    std::uint16_t* target_row = result.Row(y);
    for (int x = 0; x < target_width; ++x) {
      const int col_begin = column_start[static_cast<std::size_t>(x)];
      int col_end = column_start[static_cast<std::size_t>(x) + 1];
      if (col_end <= col_begin) col_end = col_begin + 1;

      double sum_r = 0.0;
      double sum_g = 0.0;
      double sum_b = 0.0;
      double sum_a = 0.0;
      int samples = 0;

      for (int sy = row_begin; sy < row_end; ++sy) {
        const std::uint16_t* source_row = source.Row(sy);
        for (int sx = col_begin; sx < col_end; ++sx) {
          const std::uint16_t* pixel = source_row + static_cast<std::size_t>(sx) * kChannels;
          const double alpha = pixel[3] / kMaxSample;
          sum_r += pixel[0] * alpha;
          sum_g += pixel[1] * alpha;
          sum_b += pixel[2] * alpha;
          sum_a += pixel[3];
          ++samples;
        }
      }

      std::uint16_t* target_pixel = target_row + static_cast<std::size_t>(x) * kChannels;
      if (samples == 0 || sum_a <= 0.0) {
        std::memset(target_pixel, 0, kChannels * sizeof(std::uint16_t));
        continue;
      }

      // Averaging premultiplied colour gives sum / samples; dividing by the
      // averaged alpha (sum_a / (samples * max)) collapses to sum * max / sum_a.
      const double unpremultiply = kMaxSample / sum_a;
      target_pixel[0] = ClampToSample(sum_r * unpremultiply);
      target_pixel[1] = ClampToSample(sum_g * unpremultiply);
      target_pixel[2] = ClampToSample(sum_b * unpremultiply);
      target_pixel[3] = ClampToSample(sum_a / samples);
    }
  }

  return result;
}

Image16 BilinearResize(const Image16& source, const Rect& region, int target_width,
                       int target_height, const CancellationTokenPtr& token) {
  if (target_width <= 0 || target_height <= 0) {
    throw EngineException(error_code::kInternalError, "Invalid resample target",
                          std::to_string(target_width) + "x" + std::to_string(target_height));
  }
  const Rect area = Intersect(region, Rect{0, 0, source.width(), source.height()});
  if (area.empty()) {
    throw EngineException(error_code::kInvalidRequest, "Nothing left to render",
                          "the crop region falls outside the image");
  }

  Image16 result = Image16::Create(target_width, target_height);
  const double step_x = static_cast<double>(area.width) / target_width;
  const double step_y = static_cast<double>(area.height) / target_height;

  for (int y = 0; y < target_height; ++y) {
    if (token->cancelled()) {
      throw EngineException(error_code::kCancelled, "Render cancelled", "superseded");
    }
    // Half-pixel offsets on both sides, so the sample sits at the centre of the
    // target pixel measured in source coordinates.
    const double sy = (y + 0.5) * step_y - 0.5;
    const int y0 = std::clamp(static_cast<int>(std::floor(sy)), 0, area.height - 1);
    const int y1 = std::min(y0 + 1, area.height - 1);
    const double fy = std::clamp(sy - y0, 0.0, 1.0);

    const std::uint16_t* row0 = source.Row(area.y + y0);
    const std::uint16_t* row1 = source.Row(area.y + y1);
    std::uint16_t* target_row = result.Row(y);

    for (int x = 0; x < target_width; ++x) {
      const double sx = (x + 0.5) * step_x - 0.5;
      const int x0 = std::clamp(static_cast<int>(std::floor(sx)), 0, area.width - 1);
      const int x1 = std::min(x0 + 1, area.width - 1);
      const double fx = std::clamp(sx - x0, 0.0, 1.0);

      const std::uint16_t* p00 = row0 + static_cast<std::size_t>(area.x + x0) * kChannels;
      const std::uint16_t* p10 = row0 + static_cast<std::size_t>(area.x + x1) * kChannels;
      const std::uint16_t* p01 = row1 + static_cast<std::size_t>(area.x + x0) * kChannels;
      const std::uint16_t* p11 = row1 + static_cast<std::size_t>(area.x + x1) * kChannels;

      const double w00 = (1.0 - fx) * (1.0 - fy);
      const double w10 = fx * (1.0 - fy);
      const double w01 = (1.0 - fx) * fy;
      const double w11 = fx * fy;

      const double a00 = p00[3] / kMaxSample;
      const double a10 = p10[3] / kMaxSample;
      const double a01 = p01[3] / kMaxSample;
      const double a11 = p11[3] / kMaxSample;

      const double alpha = p00[3] * w00 + p10[3] * w10 + p01[3] * w01 + p11[3] * w11;
      std::uint16_t* target_pixel = target_row + static_cast<std::size_t>(x) * kChannels;
      if (alpha <= 0.0) {
        std::memset(target_pixel, 0, kChannels * sizeof(std::uint16_t));
        continue;
      }

      const double unpremultiply = kMaxSample / alpha;
      for (int c = 0; c < 3; ++c) {
        target_pixel[c] = ClampToSample(
            (p00[c] * a00 * w00 + p10[c] * a10 * w10 + p01[c] * a01 * w01 + p11[c] * a11 * w11) *
            unpremultiply);
      }
      target_pixel[3] = ClampToSample(alpha);
    }
  }
  return result;
}

Image16 ResampleTo(const Image16& source, const Rect& region, int target_width,
                   int target_height, const CancellationTokenPtr& token) {
  const Rect area = Intersect(region, Rect{0, 0, source.width(), source.height()});
  const bool enlarging = target_width > area.width || target_height > area.height;
  return enlarging ? BilinearResize(source, region, target_width, target_height, token)
                   : DownscaleBox(source, region, target_width, target_height, token);
}

Image16 ResizeToFit(const Image16& source, int max_width, int max_height, double* out_scale) {
  const FitResult fit = FitInside(source.width(), source.height(), max_width, max_height);
  if (out_scale != nullptr) *out_scale = fit.scale;
  if (fit.width == source.width() && fit.height == source.height()) return source.Clone();
  return DownscaleBox(source, fit.width, fit.height);
}

}  // namespace photoy
