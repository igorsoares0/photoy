#pragma once

#include <vector>

#include "color/matrix.h"
#include "edit/curve.h"

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
  /**
   * Saturation that spends itself on the colours that have least.
   *
   * Where saturation scales every colour equally and blows out the ones that
   * were already strong, this weights the boost by how unsaturated a pixel
   * already is, which is what keeps a sky deepening while a face stays put.
   */
  float vibrance = 0.0f;  // -100 .. 100
  /// Rotation of the colour wheel, in degrees. Greys stay grey.
  float hue = 0.0f;  // -180 .. 180
  /// Negative darkens the corners, positive lightens them, as a lens does.
  float vignette = 0.0f;  // -100 .. 100
  /// Film grain. There is no such thing as negative grain.
  float grain = 0.0f;  // 0 .. 100
  /**
   * The two that have to look at neighbours, and so cannot be fused into the
   * per-pixel loop. See `edit/detail.h`.
   */
  float sharpen = 0.0f;  // 0 .. 100
  float clarity = 0.0f;  // -100 .. 100
  /**
   * Noise reduction, and how much of the fine detail to put back afterwards.
   *
   * Colour noise is always removed in full: smoothing colour costs no detail,
   * because detail is carried by brightness. What `denoise_detail` restores is
   * the brightness detail, which is the half that smoothing does cost.
   */
  float denoise = 0.0f;         // 0 .. 100
  float denoise_detail = 50.0f;  // 0 .. 100
  /// Warmer above zero, cooler below.
  float temperature = 0.0f;  // -100 .. 100
  /**
   * The point curves: one for tone and one for each channel.
   *
   * These are the only adjustment that is not a single number, and they are
   * here rather than in an operation of their own because a curve is an
   * adjustment - it belongs to a layer, it goes into a preset, and it has to
   * arrive in the same entry as the sliders so that the last entry is still the
   * whole state.
   */
  Curves curves;

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
  /**
   * `width` and `height` are the frame being rendered, and `scale` is how much
   * of the document one rendered pixel covers.
   *
   * Vignette needs the frame to know where a corner is. Grain needs the scale
   * as well: it belongs to the photograph, not to the screen, so it is sampled
   * in document coordinates and its amplitude is scaled the way averaging would
   * scale it, which is what keeps a preview honest about the final.
   */
  explicit CompiledAdjustments(const Adjustments& adjustments, int width = 0, int height = 0,
                               double scale = 1.0);

  bool neutral() const noexcept { return neutral_; }

  /// Applies exposure, white balance, tone, saturation, vignette and grain.
  void Apply(float& r, float& g, float& b, int x, int y) const noexcept;

 private:
  float Tone(float value, int offset) const noexcept;

  bool neutral_ = true;
  /// Exposure and white balance folded together.
  float premultiply_[9] = {1, 0, 0, 0, 1, 0, 0, 0, 1};
  bool premultiply_is_identity_ = true;
  /// Linear-in, linear-out tone response. One table, or three when the
  /// per-channel curves disagree.
  std::vector<float> tone_;
  bool tone_is_identity_ = true;
  /**
   * Where each channel's table starts inside `tone_`.
   *
   * All three are zero while the per-channel curves are identity, which is the
   * usual case and shares one table between them. As soon as one of them bends,
   * three tables are built and these separate. Holding it as an offset rather
   * than a flag keeps the inner loop free of a branch.
   */
  int channel_offset_[3] = {0, 0, 0};
  float saturation_ = 1.0f;
  float vibrance_ = 0.0f;
  float vignette_ = 0.0f;
  float grain_ = 0.0f;
  /// Frame centre and the radius that reaches a corner, in pixels.
  float centre_x_ = 0.0f;
  float centre_y_ = 0.0f;
  float inverse_half_width_ = 0.0f;
  float inverse_half_height_ = 0.0f;
  /// Rendered pixels back to document pixels, for sampling the grain.
  float to_document_ = 1.0f;
  /// Luminance weights of the working space, for the saturation blend.
  float luma_[3] = {0.0f, 1.0f, 0.0f};
};

/// Domain of the tone table, in linear light. Two stops of headroom above white
/// so that lifting exposure and then recovering highlights still has something
/// to recover.
inline constexpr float kToneDomain = 4.0f;
inline constexpr int kToneSize = 4096;

}  // namespace photoy
