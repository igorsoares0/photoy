#include "edit/detail.h"

#include <algorithm>
#include <cmath>
#include <vector>

#include "color/matrix.h"
#include "color/primaries.h"
#include "core/error.h"

namespace photoy {
namespace {

/// Radius of the sharpening blur, in document pixels.
constexpr double kSharpenRadius = 1.6;
/// Radius of the clarity blur. Local contrast is a much larger neighbourhood.
constexpr double kClarityRadius = 40.0;
/// Strength at the top of each slider. A first pass, to tune against real work.
constexpr float kSharpenStrength = 1.4f;

/// Radius of the denoise neighbourhood, in document pixels.
constexpr double kDenoiseRadius = 4.0;
/**
 * Largest variance the denoiser will call noise, in encoded units squared.
 *
 * A photograph with visible grain sits around ten levels of 255 of deviation,
 * which is a variance near 0.0015; the top of the slider reaches well past that
 * so there is somewhere to go for a bad one.
 */
constexpr float kDenoiseEpsilon = 0.012f;
constexpr float kClarityStrength = 0.6f;

void Check(const CancellationTokenPtr& token) {
  if (token->cancelled()) {
    throw EngineException(error_code::kCancelled, "Render cancelled", "superseded");
  }
}

float Encode(float linear) noexcept {
  if (linear <= 0.0031308f) return linear * 12.92f;
  return 1.055f * std::pow(linear, 1.0f / 2.4f) - 0.055f;
}

float Decode(float encoded) noexcept {
  if (encoded <= 0.04045f) return encoded / 12.92f;
  return std::pow((encoded + 0.055f) / 1.055f, 2.4f);
}

/**
 * The midtone weight clarity is scaled by, as a table.
 *
 * It is a smooth curve of one variable, and computing it per pixel means a
 * `pow` per pixel: measured at roughly half the cost of the whole clarity pass
 * on a 2.2 megapixel frame. A table of a thousand entries is indistinguishable
 * from the curve and is read in a multiply and an index.
 */
constexpr int kWeightSize = 1024;
/// Domain of the table, in linear light. Past it the weight is zero anyway.
constexpr float kWeightDomain = 1.2f;

const std::vector<float>& MidtoneWeights() {
  static const std::vector<float> table = [] {
    std::vector<float> values(kWeightSize);
    for (int i = 0; i < kWeightSize; ++i) {
      const float linear = kWeightDomain * static_cast<float>(i) / (kWeightSize - 1);
      const float e = std::clamp(Encode(linear), 0.0f, 1.0f);
      values[static_cast<std::size_t>(i)] = 4.0f * e * (1.0f - e);
    }
    return values;
  }();
  return table;
}

float MidtoneWeight(float linear) noexcept {
  if (linear <= 0.0f) return 0.0f;
  if (linear >= kWeightDomain) return 0.0f;
  const int index = static_cast<int>(linear * (kWeightSize - 1) / kWeightDomain);
  return MidtoneWeights()[static_cast<std::size_t>(index)];
}

/**
 * One horizontal pass of a moving-average blur.
 *
 * A running sum, so the cost does not depend on the radius - which matters
 * because clarity uses a radius of forty pixels and sharpening uses two, and
 * neither should be the reason a slider stutters.
 */
void BoxHorizontal(const std::vector<float>& source, std::vector<float>& target, int width,
                   int height, int radius) {
  const float inverse = 1.0f / static_cast<float>(2 * radius + 1);
  for (int y = 0; y < height; ++y) {
    const std::size_t base = static_cast<std::size_t>(y) * width;
    // The window starts clamped against the edge, which is what stops a border
    // from fading towards nothing.
    float sum = source[base] * static_cast<float>(radius + 1);
    for (int i = 1; i <= radius; ++i) sum += source[base + std::min(i, width - 1)];
    for (int x = 0; x < width; ++x) {
      target[base + static_cast<std::size_t>(x)] = sum * inverse;
      sum += source[base + static_cast<std::size_t>(std::min(width - 1, x + radius + 1))] -
             source[base + static_cast<std::size_t>(std::max(0, x - radius))];
    }
  }
}

/**
 * The same downwards, carrying one running sum per column.
 *
 * Written this way rather than as a column-at-a-time loop because a column walk
 * steps a whole row through memory for every pixel it reads. Keeping the sums
 * in an array and walking rows in order reads both buffers sequentially, which
 * on a two-megapixel frame is the difference between the blur being noticeable
 * and not.
 */
void BoxVertical(const std::vector<float>& source, std::vector<float>& target, int width,
                 int height, int radius) {
  const float inverse = 1.0f / static_cast<float>(2 * radius + 1);
  std::vector<float> sums(static_cast<std::size_t>(width));

  for (int x = 0; x < width; ++x) sums[static_cast<std::size_t>(x)] = source[x] * (radius + 1);
  for (int i = 1; i <= radius; ++i) {
    const std::size_t row = static_cast<std::size_t>(std::min(i, height - 1)) * width;
    for (int x = 0; x < width; ++x) sums[static_cast<std::size_t>(x)] += source[row + x];
  }

  for (int y = 0; y < height; ++y) {
    const std::size_t out = static_cast<std::size_t>(y) * width;
    const std::size_t entering =
        static_cast<std::size_t>(std::min(height - 1, y + radius + 1)) * width;
    const std::size_t leaving = static_cast<std::size_t>(std::max(0, y - radius)) * width;
    for (int x = 0; x < width; ++x) {
      const std::size_t column = static_cast<std::size_t>(x);
      target[out + column] = sums[column] * inverse;
      sums[column] += source[entering + column] - source[leaving + column];
    }
  }
}

/// Three box passes each way, which is close enough to a Gaussian to be one.
void Blur(std::vector<float>& values, std::vector<float>& scratch, int width, int height,
          int radius, const CancellationTokenPtr& token) {
  if (radius < 1) return;
  for (int pass = 0; pass < 3; ++pass) {
    Check(token);
    BoxHorizontal(values, scratch, width, height, radius);
    BoxVertical(scratch, values, width, height, radius);
  }
}

}  // namespace

bool DetailIsNeutral(const Adjustments& adjustments) noexcept {
  return adjustments.sharpen == 0.0f && adjustments.clarity == 0.0f &&
         adjustments.denoise == 0.0f;
}

namespace {

/**
 * A guided filter, which is the honest way to smooth without losing edges.
 *
 * For every neighbourhood it fits the straight line that best predicts the
 * picture from itself, and `epsilon` is how much variance it is willing to call
 * noise rather than signal. Where the variance is far above it - an edge - the
 * fit is the identity and nothing is touched. Where it is far below - flat
 * grain - the fit collapses to the local mean and the grain goes.
 *
 * It costs the same whatever the radius, because everything in it is a box
 * average, and box averages are running sums. That is the whole reason this is
 * a filter the machine can run while somebody watches, and a transformer is
 * not: SCUNet does this better and takes fifty seconds a megapixel to do it.
 */
void GuidedFilter(const std::vector<float>& guide, std::vector<float>& value, int width,
                  int height, int radius, float epsilon, std::vector<float>& scratch,
                  const CancellationTokenPtr& token) {
  const std::size_t count = static_cast<std::size_t>(width) * height;
  std::vector<float> mean_guide = guide;
  std::vector<float> mean_value = value;
  std::vector<float> corr_guide(count);
  std::vector<float> corr_cross(count);
  for (std::size_t i = 0; i < count; ++i) {
    corr_guide[i] = guide[i] * guide[i];
    corr_cross[i] = guide[i] * value[i];
  }

  Check(token);
  BoxHorizontal(mean_guide, scratch, width, height, radius);
  BoxVertical(scratch, mean_guide, width, height, radius);
  BoxHorizontal(mean_value, scratch, width, height, radius);
  BoxVertical(scratch, mean_value, width, height, radius);
  BoxHorizontal(corr_guide, scratch, width, height, radius);
  BoxVertical(scratch, corr_guide, width, height, radius);
  BoxHorizontal(corr_cross, scratch, width, height, radius);
  BoxVertical(scratch, corr_cross, width, height, radius);
  Check(token);

  // a and b are the slope and the offset of that line, reused in place.
  for (std::size_t i = 0; i < count; ++i) {
    const float variance = corr_guide[i] - mean_guide[i] * mean_guide[i];
    const float covariance = corr_cross[i] - mean_guide[i] * mean_value[i];
    const float a = covariance / (variance + epsilon);
    corr_guide[i] = a;
    corr_cross[i] = mean_value[i] - a * mean_guide[i];
  }

  // Averaged again, because a pixel belongs to every window that covers it and
  // the answer is what those windows agree on.
  BoxHorizontal(corr_guide, scratch, width, height, radius);
  BoxVertical(scratch, corr_guide, width, height, radius);
  BoxHorizontal(corr_cross, scratch, width, height, radius);
  BoxVertical(scratch, corr_cross, width, height, radius);
  Check(token);

  for (std::size_t i = 0; i < count; ++i) value[i] = corr_guide[i] * guide[i] + corr_cross[i];
}

}  // namespace

void ApplyDetail(Image16& image, const Adjustments& adjustments, const CompiledMask& mask,
                 float opacity, double scale, const CancellationTokenPtr& token) {
  if (DetailIsNeutral(adjustments) || image.empty() || opacity <= 0.0f) return;

  const int width = image.width();
  const int height = image.height();
  const std::size_t count = static_cast<std::size_t>(width) * height;

  const color::Mat3 to_xyz = color::RgbToXyz(color::kWorkingSpace);
  float luma_weights[3];
  for (int i = 0; i < 3; ++i) luma_weights[i] = static_cast<float>(to_xyz.At(1, i));

  constexpr float kFromSample = 1.0f / 65535.0f;
  std::vector<float> luma(count);
  for (int y = 0; y < height; ++y) {
    const std::uint16_t* row = image.Row(y);
    for (int x = 0; x < width; ++x) {
      const std::size_t index = static_cast<std::size_t>(x) * kChannels;
      luma[static_cast<std::size_t>(y) * width + x] =
          (luma_weights[0] * row[index + 0] + luma_weights[1] * row[index + 1] +
           luma_weights[2] * row[index + 2]) *
          kFromSample;
    }
  }
  Check(token);

  std::vector<float> blurred;
  std::vector<float> scratch(count);

  // Denoise first, always. Sharpening noise is how a denoiser gets blamed for
  // making a photograph worse, and clarity does the same at a larger scale.
  if (adjustments.denoise > 0.0f) {
    const float strength = std::clamp(adjustments.denoise, 0.0f, 100.0f) / 100.0f;
    const float keep = std::clamp(adjustments.denoise_detail, 0.0f, 100.0f) / 100.0f;
    const int radius = std::max(1, static_cast<int>(std::lround(kDenoiseRadius * scale)));
    const float epsilon = strength * strength * kDenoiseEpsilon;

    // Filtered where noise looks even, which is the encoded domain rather than
    // linear light: in linear light a shadow's grain is numerically tiny and
    // would be spared, though it is the grain people actually see.
    std::vector<float> channels[3] = {std::vector<float>(count), std::vector<float>(count),
                                      std::vector<float>(count)};
    std::vector<float> guide(count);
    for (int y = 0; y < height; ++y) {
      const std::uint16_t* row = image.Row(y);
      for (int x = 0; x < width; ++x) {
        const std::size_t plane_index = static_cast<std::size_t>(y) * width + x;
        const std::size_t index = static_cast<std::size_t>(x) * kChannels;
        for (int c = 0; c < 3; ++c) {
          channels[c][plane_index] = Encode(row[index + c] * kFromSample);
        }
        guide[plane_index] = Encode(luma[plane_index]);
      }
    }
    Check(token);

    // One guide for all three channels, so they are smoothed along the same
    // structure and an edge does not come apart into coloured fringes.
    const std::vector<float> original_guide = guide;
    for (int c = 0; c < 3; ++c) {
      GuidedFilter(original_guide, channels[c], width, height, radius, epsilon, scratch, token);
    }

    for (int y = 0; y < height; ++y) {
      Check(token);
      std::uint16_t* row = image.Row(y);
      for (int x = 0; x < width; ++x) {
        const std::size_t plane_index = static_cast<std::size_t>(y) * width + x;
        const float coverage = opacity * mask.At(x, y);
        if (coverage <= 0.0f) continue;

        // The brightness detail the smoothing cost, put back by however much
        // the user asked for. Colour detail is not restored: there is none to
        // lose, and colour noise is the half worth removing outright.
        const float smoothed_luma =
            0.2126f * channels[0][plane_index] + 0.7152f * channels[1][plane_index] +
            0.0722f * channels[2][plane_index];
        const float restored = (original_guide[plane_index] - smoothed_luma) * keep;

        const std::size_t index = static_cast<std::size_t>(x) * kChannels;
        for (int c = 0; c < 3; ++c) {
          const float cleaned =
              Decode(std::clamp(channels[c][plane_index] + restored, 0.0f, 1.0f));
          const float value = row[index + c] * kFromSample;
          row[index + c] = static_cast<std::uint16_t>(
              std::clamp(value + (cleaned - value) * coverage, 0.0f, 1.0f) * 65535.0f + 0.5f);
        }
      }
    }

    // Everything after this measures the picture as the denoiser left it.
    for (int y = 0; y < height; ++y) {
      const std::uint16_t* row = image.Row(y);
      for (int x = 0; x < width; ++x) {
        const std::size_t index = static_cast<std::size_t>(x) * kChannels;
        luma[static_cast<std::size_t>(y) * width + x] =
            (luma_weights[0] * row[index + 0] + luma_weights[1] * row[index + 1] +
             luma_weights[2] * row[index + 2]) *
            kFromSample;
      }
    }
  }

  // Clarity first, then sharpening: the large-scale contrast is what the small
  // scale should be sharpening, not the other way round.
  const struct {
    float amount;
    double radius;
    bool midtones;
  } stages[2] = {
      {adjustments.clarity / 100.0f * kClarityStrength, kClarityRadius, true},
      {adjustments.sharpen / 100.0f * kSharpenStrength, kSharpenRadius, false},
  };

  for (const auto& stage : stages) {
    if (stage.amount == 0.0f) continue;
    const int radius = std::max(1, static_cast<int>(std::lround(stage.radius * scale)));
    blurred = luma;
    Blur(blurred, scratch, width, height, radius, token);

    for (int y = 0; y < height; ++y) {
      Check(token);
      std::uint16_t* row = image.Row(y);
      for (int x = 0; x < width; ++x) {
        const std::size_t plane = static_cast<std::size_t>(y) * width + x;
        // The detail this radius sees: what the pixel has that its
        // neighbourhood does not.
        float detail = luma[plane] - blurred[plane];
        if (stage.midtones) {
          // Clarity in the blacks turns them muddy and in the highlights it
          // turns them chalky, so it is weighted towards the middle.
          detail *= MidtoneWeight(luma[plane]);
        }
        const float coverage = opacity * mask.At(x, y);
        if (coverage <= 0.0f) continue;
        const float lift = detail * stage.amount * coverage;

        const std::size_t index = static_cast<std::size_t>(x) * kChannels;
        for (int c = 0; c < 3; ++c) {
          const float value = row[index + c] * kFromSample + lift;
          row[index + c] = static_cast<std::uint16_t>(
              std::clamp(value, 0.0f, 1.0f) * 65535.0f + 0.5f);
        }
      }
    }
    // The next stage measures the picture as this one left it.
    for (int y = 0; y < height; ++y) {
      const std::uint16_t* row = image.Row(y);
      for (int x = 0; x < width; ++x) {
        const std::size_t index = static_cast<std::size_t>(x) * kChannels;
        luma[static_cast<std::size_t>(y) * width + x] =
            (luma_weights[0] * row[index + 0] + luma_weights[1] * row[index + 1] +
             luma_weights[2] * row[index + 2]) *
            kFromSample;
      }
    }
  }
}

}  // namespace photoy
