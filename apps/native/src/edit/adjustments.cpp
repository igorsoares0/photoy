#include "edit/adjustments.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

#include "color/primaries.h"

namespace photoy {
namespace {

using color::Mat3;

/// The sRGB transfer curve, used here purely as a perceptual yardstick: tone
/// controls behave the way people expect when they act on roughly perceptual
/// values rather than on linear light. Both directions extend past 1, which is
/// what keeps headroom available to the highlight control.
float Encode(float linear) noexcept {
  if (linear <= 0.0031308f) return linear * 12.92f;
  return 1.055f * std::pow(linear, 1.0f / 2.4f) - 0.055f;
}

float Decode(float encoded) noexcept {
  if (encoded <= 0.04045f) return encoded / 12.92f;
  return std::pow((encoded + 0.055f) / 1.055f, 2.4f);
}

float SmoothStep(float edge0, float edge1, float value) noexcept {
  const float t = std::clamp((value - edge0) / (edge1 - edge0), 0.0f, 1.0f);
  return t * t * (3.0f - 2.0f * t);
}

/**
 * Correlated colour temperature to a chromaticity on the daylight locus.
 *
 * The CIE daylight approximation, which is the right curve for a white balance
 * control: it is where real daylight sits, and where a camera's own white
 * balance presets sit.
 */
color::Chromaticity DaylightWhite(double kelvin) noexcept {
  const double t = std::clamp(kelvin, 2000.0, 25000.0);
  double x = 0.0;
  if (t <= 7000.0) {
    x = -4.6070e9 / (t * t * t) + 2.9678e6 / (t * t) + 0.09911e3 / t + 0.244063;
  } else {
    x = -2.0064e9 / (t * t * t) + 1.9018e6 / (t * t) + 0.24748e3 / t + 0.237040;
  }
  const double y = -3.0 * x * x + 2.87 * x - 0.275;
  return {x, y};
}

/// The slider maps to a temperature around the working space's own white point,
/// logarithmically, so a step feels the same size at both ends of the range.
double TemperatureFor(float slider) noexcept {
  constexpr double kNeutral = 5000.0;  // D50, the working space white
  return kNeutral * std::pow(2.0, -static_cast<double>(slider) / 100.0);
}

/**
 * A hue rotation that leaves greys grey and luminance where it was.
 *
 * The rotation itself is Rodrigues about the neutral axis, which is what makes
 * a grey stay grey exactly rather than nearly. That alone moves luminance for
 * saturated colours, so it is corrected by a rank-one update: with weights that
 * sum to one, `R + 1 (w^T (I - R))` rotates exactly as R does while leaving
 * `w . x` untouched for every x - and it is still a matrix, so it folds into
 * the same premultiply as exposure and white balance and costs nothing extra.
 */
Mat3 HueRotation(float degrees, const float weights[3]) noexcept {
  const double angle = static_cast<double>(degrees) * 3.14159265358979323846 / 180.0;
  const double c = std::cos(angle);
  const double s = std::sin(angle);
  // Rodrigues about (1,1,1)/sqrt(3).
  const double a = (1.0 - c) / 3.0;
  const double d = s / std::sqrt(3.0);
  Mat3 rotation;
  rotation.m[0] = c + a;      rotation.m[1] = a - d;      rotation.m[2] = a + d;
  rotation.m[3] = a + d;      rotation.m[4] = c + a;      rotation.m[5] = a - d;
  rotation.m[6] = a - d;      rotation.m[7] = a + d;      rotation.m[8] = c + a;

  Mat3 corrected;
  for (int column = 0; column < 3; ++column) {
    // The column of w^T (I - R): how much luminance this input channel loses.
    double lost = weights[column];
    for (int row = 0; row < 3; ++row) lost -= weights[row] * rotation.m[row * 3 + column];
    for (int row = 0; row < 3; ++row) {
      corrected.m[row * 3 + column] = rotation.m[row * 3 + column] + lost;
    }
  }
  return corrected;
}

/// A deterministic hash, so the same render twice is the same picture.
std::uint32_t Hash(std::uint32_t x, std::uint32_t y) noexcept {
  std::uint32_t h = x * 0x9E3779B1u ^ y * 0x85EBCA77u;
  h ^= h >> 15;
  h *= 0x2C1B3C6Du;
  h ^= h >> 12;
  h *= 0x297A2D39u;
  h ^= h >> 15;
  return h;
}

}  // namespace

bool Adjustments::IsNeutral() const noexcept {
  return exposure == 0.0f && brightness == 0.0f && contrast == 0.0f && highlights == 0.0f &&
         shadows == 0.0f && saturation == 0.0f && vibrance == 0.0f && hue == 0.0f &&
         vignette == 0.0f && grain == 0.0f && sharpen == 0.0f && clarity == 0.0f &&
         temperature == 0.0f;
}

bool Adjustments::operator==(const Adjustments& other) const noexcept {
  return exposure == other.exposure && brightness == other.brightness &&
         contrast == other.contrast && highlights == other.highlights &&
         shadows == other.shadows && saturation == other.saturation &&
         vibrance == other.vibrance && hue == other.hue && vignette == other.vignette &&
         grain == other.grain && sharpen == other.sharpen && clarity == other.clarity &&
         temperature == other.temperature;
}

CompiledAdjustments::CompiledAdjustments() = default;

CompiledAdjustments::CompiledAdjustments(const Adjustments& adjustments, int width, int height,
                                         double scale) {
  neutral_ = adjustments.IsNeutral();
  if (neutral_) return;

  if (width > 0 && height > 0) {
    centre_x_ = static_cast<float>(width) * 0.5f;
    centre_y_ = static_cast<float>(height) * 0.5f;
    inverse_half_width_ = 1.0f / centre_x_;
    inverse_half_height_ = 1.0f / centre_y_;
    vignette_ = adjustments.vignette / 100.0f;
    // Amplitude falls with the scale because a reduction averages grain away:
    // a preview at a quarter size shows a quarter of it, which is what the
    // export would look like reduced to that size.
    grain_ = std::clamp(adjustments.grain, 0.0f, 100.0f) / 100.0f *
             static_cast<float>(std::clamp(scale, 0.0, 1.0));
    to_document_ = scale > 0.0 ? static_cast<float>(1.0 / scale) : 1.0f;
  }

  // Luminance weights are the Y row of the working space's own RGB-to-XYZ
  // matrix. Using Rec.709 weights here would desaturate towards the wrong grey.
  const Mat3 to_xyz = color::RgbToXyz(color::kWorkingSpace);
  for (int i = 0; i < 3; ++i) luma_[i] = static_cast<float>(to_xyz.At(1, i));

  // Exposure is a scalar and white balance is a matrix, and both are linear, so
  // they multiply together and cost one matrix instead of two passes.
  Mat3 pre;
  if (adjustments.temperature != 0.0f) {
    // Towards the target illuminant, not away from it: a positive slider means
    // the picture should look warmer, so the adaptation runs from the working
    // white to a warmer one.
    pre = color::Adapt(color::kWorkingSpace.white,
                       DaylightWhite(TemperatureFor(adjustments.temperature)));
  }
  if (adjustments.hue != 0.0f) {
    pre = color::Multiply(HueRotation(adjustments.hue, luma_), pre);
  }
  const double gain = std::pow(2.0, static_cast<double>(adjustments.exposure));
  for (int i = 0; i < 9; ++i) premultiply_[i] = static_cast<float>(pre.m[i] * gain);
  premultiply_is_identity_ = adjustments.temperature == 0.0f && adjustments.exposure == 0.0f &&
                             adjustments.hue == 0.0f;

  saturation_ = 1.0f + adjustments.saturation / 100.0f;
  vibrance_ = adjustments.vibrance / 100.0f;

  tone_is_identity_ = adjustments.brightness == 0.0f && adjustments.contrast == 0.0f &&
                      adjustments.highlights == 0.0f && adjustments.shadows == 0.0f;
  if (tone_is_identity_) return;

  const float brightness = adjustments.brightness / 100.0f;
  const float contrast = adjustments.contrast / 100.0f;
  const float highlights = adjustments.highlights / 100.0f;
  const float shadows = adjustments.shadows / 100.0f;

  tone_.resize(kToneSize);
  for (int i = 0; i < kToneSize; ++i) {
    const float linear = kToneDomain * static_cast<float>(i) / (kToneSize - 1);
    float e = Encode(linear);

    // Brightness as a gamma tilt: midtones move, black and white stay put.
    if (brightness != 0.0f && e > 0.0f) {
      e = std::pow(e, 1.0f / (1.0f + brightness * 0.8f));
    }

    // Contrast as an S-curve blended in, rather than a slope through the pivot,
    // so pushing it hard rolls off instead of clipping.
    if (contrast != 0.0f) {
      const float clamped = std::clamp(e, 0.0f, 1.0f);
      const float s = SmoothStep(0.0f, 1.0f, clamped);
      const float target = contrast > 0.0f ? s : 2.0f * clamped - s;
      e += (target - clamped) * std::abs(contrast);
    }

    // Each of these acts only on its end of the range, so moving highlights
    // leaves the shadows measurably alone. The strengths below are a first
    // pass: they are the part of this file to tune against real photographs.
    if (highlights != 0.0f) {
      const float weight = SmoothStep(0.4f, 1.0f, e);
      e += 0.35f * highlights * weight * (highlights > 0.0f ? std::max(0.0f, 1.2f - e) : e);
    }
    if (shadows != 0.0f) {
      // The second factor holds absolute black in place: lifting shadows should
      // open up the dark tones, not turn the blacks grey.
      const float weight = (1.0f - SmoothStep(0.0f, 0.6f, e)) * SmoothStep(0.0f, 0.08f, e);
      e += 0.45f * shadows * weight * (shadows > 0.0f ? std::max(0.0f, 1.0f - e) : e);
    }

    tone_[static_cast<std::size_t>(i)] = std::max(0.0f, Decode(std::max(0.0f, e)));
  }
}

float CompiledAdjustments::Tone(float value) const noexcept {
  if (tone_is_identity_) return value;
  if (value <= 0.0f) return tone_.front();
  if (value >= kToneDomain) {
    // Past the table the response is held, which keeps a blown highlight blown
    // rather than folding it back down.
    return tone_.back();
  }
  const float position = value * (kToneSize - 1) / kToneDomain;
  const int index = static_cast<int>(position);
  const float fraction = position - static_cast<float>(index);
  const float low = tone_[static_cast<std::size_t>(index)];
  const float high = tone_[static_cast<std::size_t>(index) + 1];
  return low + (high - low) * fraction;
}

void CompiledAdjustments::Apply(float& r, float& g, float& b, int x, int y) const noexcept {
  if (neutral_) return;

  if (!premultiply_is_identity_) {
    const float nr = premultiply_[0] * r + premultiply_[1] * g + premultiply_[2] * b;
    const float ng = premultiply_[3] * r + premultiply_[4] * g + premultiply_[5] * b;
    const float nb = premultiply_[6] * r + premultiply_[7] * g + premultiply_[8] * b;
    r = nr;
    g = ng;
    b = nb;
  }

  r = Tone(r);
  g = Tone(g);
  b = Tone(b);

  if (saturation_ != 1.0f) {
    const float luma = luma_[0] * r + luma_[1] * g + luma_[2] * b;
    r = luma + (r - luma) * saturation_;
    g = luma + (g - luma) * saturation_;
    b = luma + (b - luma) * saturation_;
  }

  if (vibrance_ != 0.0f) {
    const float luma = luma_[0] * r + luma_[1] * g + luma_[2] * b;
    const float highest = std::max({r, g, b});
    const float lowest = std::min({r, g, b});
    // How far this pixel already is from grey, relative to its own brightness.
    // A pixel that is already vivid gets almost nothing; a flat one gets it all.
    // Unlike Lightroom's, this weight does not single out skin tones - doing
    // that needs a hue-dependent term, and tuning one without photographs of
    // people to check it against would be guessing.
    const float current = highest > 1.0e-4f ? (highest - lowest) / highest : 0.0f;
    const float factor = 1.0f + vibrance_ * (1.0f - std::clamp(current, 0.0f, 1.0f));
    r = luma + (r - luma) * factor;
    g = luma + (g - luma) * factor;
    b = luma + (b - luma) * factor;
  }

  if (vignette_ != 0.0f) {
    // An ellipse that touches the frame, normalised so a corner sits at one.
    const float dx = (static_cast<float>(x) + 0.5f - centre_x_) * inverse_half_width_;
    const float dy = (static_cast<float>(y) + 0.5f - centre_y_) * inverse_half_height_;
    const float distance = std::sqrt(dx * dx + dy * dy) * 0.70710678f;
    // A multiply in linear light, because that is what a lens actually does to
    // the light reaching the corners of the frame.
    const float gain = 1.0f + vignette_ * SmoothStep(0.25f, 1.0f, distance);
    r *= gain;
    g *= gain;
    b *= gain;
  }

  if (grain_ > 0.0f) {
    // Sampled in document coordinates, so the grain belongs to the photograph
    // rather than to the zoom it is being looked at.
    const auto dx = static_cast<std::uint32_t>(static_cast<float>(x) * to_document_);
    const auto dy = static_cast<std::uint32_t>(static_cast<float>(y) * to_document_);
    const float noise = static_cast<float>(Hash(dx, dy)) * (2.0f / 4294967296.0f) - 1.0f;

    // Grain is least visible in the blacks and in a blown highlight, so the
    // amplitude follows a midtone weight. The constant below is a first pass:
    // it is the part of this to tune against real photographs.
    const float luma = luma_[0] * r + luma_[1] * g + luma_[2] * b;
    const float e = std::clamp(Encode(luma), 0.0f, 1.0f);
    const float weight = 4.0f * e * (1.0f - e);
    const float amplitude = noise * grain_ * weight * 0.06f;
    r = std::max(0.0f, r + amplitude);
    g = std::max(0.0f, g + amplitude);
    b = std::max(0.0f, b + amplitude);
  }
}

}  // namespace photoy
