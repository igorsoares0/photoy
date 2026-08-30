#include "edit/adjustments.h"

#include <algorithm>
#include <cmath>

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

}  // namespace

bool Adjustments::IsNeutral() const noexcept {
  return exposure == 0.0f && brightness == 0.0f && contrast == 0.0f && highlights == 0.0f &&
         shadows == 0.0f && saturation == 0.0f && temperature == 0.0f;
}

bool Adjustments::operator==(const Adjustments& other) const noexcept {
  return exposure == other.exposure && brightness == other.brightness &&
         contrast == other.contrast && highlights == other.highlights &&
         shadows == other.shadows && saturation == other.saturation &&
         temperature == other.temperature;
}

CompiledAdjustments::CompiledAdjustments() = default;

CompiledAdjustments::CompiledAdjustments(const Adjustments& adjustments) {
  neutral_ = adjustments.IsNeutral();
  if (neutral_) return;

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
  const double gain = std::pow(2.0, static_cast<double>(adjustments.exposure));
  for (int i = 0; i < 9; ++i) premultiply_[i] = static_cast<float>(pre.m[i] * gain);
  premultiply_is_identity_ = adjustments.temperature == 0.0f && adjustments.exposure == 0.0f;

  saturation_ = 1.0f + adjustments.saturation / 100.0f;

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

void CompiledAdjustments::Apply(float& r, float& g, float& b) const noexcept {
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
}

}  // namespace photoy
