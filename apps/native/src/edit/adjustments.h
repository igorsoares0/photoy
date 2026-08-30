#pragma once

#include <vector>

#include "color/matrix.h"

namespace photoy {

/**
 * The basic adjustment set.
 *
 * Every value is neutral at zero and carries the range the UI shows, so a
 * document with no adjustments is bit-identical to one that never had any.
 */
struct Adjustments {
  /// Stops of light. A pure multiply in the linear working space.
  float exposure = 0.0f;   // -5 .. +5 EV
  /// Midtone lift that leaves black and white where they are.
  float brightness = 0.0f;  // -100 .. 100
  float contrast = 0.0f;    // -100 .. 100
  float highlights = 0.0f;  // -100 .. 100
  float shadows = 0.0f;     // -100 .. 100
  float saturation = 0.0f;  // -100 .. 100
  /// Warmer above zero, cooler below.
  float temperature = 0.0f;  // -100 .. 100

  bool IsNeutral() const noexcept;
  bool operator==(const Adjustments& other) const noexcept;
  bool operator!=(const Adjustments& other) const noexcept { return !(*this == other); }
};

/**
 * Adjustments turned into the form the per-pixel loop wants.
 *
 * Built once whenever a slider moves, not once per pixel. Two things fall out
 * of the fact that the working space is linear: exposure and white balance are
 * both linear operations, so they collapse into a single matrix that costs
 * nothing extra to apply; and the tone controls are all functions of one
 * channel, so they collapse into a single lookup table.
 */
class CompiledAdjustments {
 public:
  CompiledAdjustments();
  explicit CompiledAdjustments(const Adjustments& adjustments);

  bool neutral() const noexcept { return neutral_; }

  /// Applies exposure, white balance, tone and saturation, in that order.
  void Apply(float& r, float& g, float& b) const noexcept;

 private:
  float Tone(float value) const noexcept;

  bool neutral_ = true;
  /// Exposure and white balance folded together.
  float premultiply_[9] = {1, 0, 0, 0, 1, 0, 0, 0, 1};
  bool premultiply_is_identity_ = true;
  /// Linear-in, linear-out tone response.
  std::vector<float> tone_;
  bool tone_is_identity_ = true;
  float saturation_ = 1.0f;
  /// Luminance weights of the working space, for the saturation blend.
  float luma_[3] = {0.0f, 1.0f, 0.0f};
};

/// Domain of the tone table, in linear light. Two stops of headroom above white
/// so that lifting exposure and then recovering highlights still has something
/// to recover.
inline constexpr float kToneDomain = 4.0f;
inline constexpr int kToneSize = 4096;

}  // namespace photoy
