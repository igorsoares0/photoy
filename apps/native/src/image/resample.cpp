#include "image/resample.h"

#include <algorithm>
#include <array>
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

namespace {

/// Lobes either side of centre. Three is the usual choice: two is noticeably
/// softer and four costs a third more for a difference nobody sees.
constexpr int kLanczosRadius = 3;

double Sinc(double x) noexcept {
  if (std::abs(x) < 1.0e-9) return 1.0;
  const double pi_x = 3.14159265358979323846 * x;
  return std::sin(pi_x) / pi_x;
}

/// The windowed sinc itself: a sinc multiplied by a wider sinc that brings it
/// to zero at the edge of the window, so the kernel ends rather than being cut.
double Lanczos(double x) noexcept {
  if (std::abs(x) >= kLanczosRadius) return 0.0;
  return Sinc(x) * Sinc(x / kLanczosRadius);
}

/// One axis worth of taps: which source samples a target sample reads, and how
/// much of each. Precomputed per target position because every row repeats the
/// same horizontal weights, and every column the same vertical ones.
struct Taps {
  int first = 0;
  std::array<double, kLanczosRadius * 2> weight{};
  int count = 0;
};

std::vector<Taps> PlanTaps(int source_length, int target_length, double offset) {
  std::vector<Taps> plan(static_cast<std::size_t>(target_length));
  const double step = static_cast<double>(source_length) / target_length;
  for (int i = 0; i < target_length; ++i) {
    const double centre = (i + 0.5) * step - 0.5;
    Taps taps;
    taps.first = static_cast<int>(std::floor(centre)) - kLanczosRadius + 1;
    double total = 0.0;
    for (int k = 0; k < kLanczosRadius * 2; ++k) {
      const double weight = Lanczos(centre - (taps.first + k));
      taps.weight[static_cast<std::size_t>(k)] = weight;
      total += weight;
    }
    // Normalised so a flat region keeps its value: the weights of a windowed
    // sinc do not sum to one on their own, and the error shows as banding.
    if (std::abs(total) > 1.0e-9) {
      for (double& weight : taps.weight) weight /= total;
    }
    taps.first += static_cast<int>(offset);
    taps.count = kLanczosRadius * 2;
    plan[static_cast<std::size_t>(i)] = taps;
  }
  return plan;
}

}  // namespace

Image16 LanczosResize(const Image16& source, const Rect& region, int target_width,
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

  const std::vector<Taps> horizontal = PlanTaps(area.width, target_width, area.x);
  const std::vector<Taps> vertical = PlanTaps(area.height, target_height, area.y);

  // The intermediate is target-wide and source-tall, holding premultiplied
  // colour and alpha in floating point: rounding to sixteen bits between the
  // two passes would throw away exactly the precision the second pass needs.
  const std::size_t stride = static_cast<std::size_t>(target_width) * kChannels;
  std::vector<float> intermediate(stride * static_cast<std::size_t>(area.height));

  for (int y = 0; y < area.height; ++y) {
    if (token->cancelled()) {
      throw EngineException(error_code::kCancelled, "Render cancelled", "superseded");
    }
    const std::uint16_t* row = source.Row(area.y + y);
    float* out = intermediate.data() + stride * static_cast<std::size_t>(y);
    for (int x = 0; x < target_width; ++x) {
      const Taps& taps = horizontal[static_cast<std::size_t>(x)];
      double sum[kChannels] = {0.0, 0.0, 0.0, 0.0};
      for (int k = 0; k < taps.count; ++k) {
        const int sx = std::clamp(taps.first + k, area.x, area.x + area.width - 1);
        const std::uint16_t* pixel = row + static_cast<std::size_t>(sx) * kChannels;
        const double weight = taps.weight[static_cast<std::size_t>(k)];
        // Premultiplied, so a transparent neighbour cannot drag its colour into
        // a visible edge - the same reason the box filter does it.
        const double alpha = pixel[3] / kMaxSample;
        for (int c = 0; c < 3; ++c) sum[c] += pixel[c] * alpha * weight;
        sum[3] += pixel[3] * weight;
      }
      float* target = out + static_cast<std::size_t>(x) * kChannels;
      for (int c = 0; c < kChannels; ++c) target[c] = static_cast<float>(sum[c]);
    }
  }

  Image16 result = Image16::Create(target_width, target_height);
  for (int y = 0; y < target_height; ++y) {
    if (token->cancelled()) {
      throw EngineException(error_code::kCancelled, "Render cancelled", "superseded");
    }
    const Taps& taps = vertical[static_cast<std::size_t>(y)];
    std::uint16_t* out = result.Row(y);
    for (int x = 0; x < target_width; ++x) {
      double sum[kChannels] = {0.0, 0.0, 0.0, 0.0};
      for (int k = 0; k < taps.count; ++k) {
        const int sy = std::clamp(taps.first + k - area.y, 0, area.height - 1);
        const float* pixel = intermediate.data() + stride * static_cast<std::size_t>(sy) +
                             static_cast<std::size_t>(x) * kChannels;
        const double weight = taps.weight[static_cast<std::size_t>(k)];
        for (int c = 0; c < kChannels; ++c) sum[c] += pixel[c] * weight;
      }

      std::uint16_t* target = out + static_cast<std::size_t>(x) * kChannels;
      const double alpha = std::clamp(sum[3], 0.0, kMaxSample);
      if (alpha <= 0.0) {
        std::memset(target, 0, kChannels * sizeof(std::uint16_t));
        continue;
      }
      const double unpremultiply = kMaxSample / alpha;
      for (int c = 0; c < 3; ++c) target[c] = ClampToSample(sum[c] * unpremultiply);
      target[3] = ClampToSample(alpha);
    }
  }
  return result;
}

Image16 ResampleTo(const Image16& source, const Rect& region, int target_width,
                   int target_height, const CancellationTokenPtr& token) {
  const Rect area = Intersect(region, Rect{0, 0, source.width(), source.height()});
  const bool enlarging = target_width > area.width || target_height > area.height;
  return enlarging ? LanczosResize(source, region, target_width, target_height, token)
                   : DownscaleBox(source, region, target_width, target_height, token);
}

Image16 ResizeToFit(const Image16& source, int max_width, int max_height, double* out_scale) {
  const FitResult fit = FitInside(source.width(), source.height(), max_width, max_height);
  if (out_scale != nullptr) *out_scale = fit.scale;
  if (fit.width == source.width() && fit.height == source.height()) return source.Clone();
  return DownscaleBox(source, fit.width, fit.height);
}

}  // namespace photoy
