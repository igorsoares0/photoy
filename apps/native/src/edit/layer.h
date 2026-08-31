#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "edit/adjustments.h"
#include "edit/mask.h"

namespace photoy {

/**
 * Layer kinds.
 *
 * The bottom of every stack is the background: the decoded original, which
 * cannot be removed, reordered or adjusted. It is the visual proof of the
 * non-destructive model - whatever is done above it, it is still there.
 */
enum class LayerKind { kBackground, kAdjustment, kMatte };

/// What takes the place of what a matte layer removes.
enum class FillKind { kTransparent, kColor };

const char* FillKindName(FillKind kind) noexcept;
FillKind FillKindFromName(const std::string& name) noexcept;

/// A colour the user picked, in sRGB, 0-1 per channel.
struct FillColor {
  float r = 1.0f;
  float g = 1.0f;
  float b = 1.0f;
};

/// How a layer's result is mixed back into what is beneath it.
enum class BlendMode { kNormal, kMultiply, kScreen, kOverlay, kSoftLight };

const char* LayerKindName(LayerKind kind) noexcept;
const char* BlendModeName(BlendMode mode) noexcept;
BlendMode BlendModeFromName(const std::string& name) noexcept;

struct Layer {
  std::uint64_t id = 0;
  LayerKind kind = LayerKind::kAdjustment;
  bool visible = true;
  /// 0 to 1.
  float opacity = 1.0f;
  BlendMode blend = BlendMode::kNormal;
  /// Meaningful for kAdjustment; ignored on the background.
  Adjustments adjustments;
  /// Where the layer applies. A layer without one applies everywhere.
  Mask mask;

  /**
   * kMatte: what replaces the part the mask excludes.
   *
   * A matte layer is how a background is removed. It is a layer rather than a
   * destructive operation for the same reason everything else here is: the
   * original stays underneath, and the removal can be undone, remasked or
   * turned off without the photograph having been touched.
   */
  FillKind fill = FillKind::kTransparent;
  FillColor color;
  /// Shown in the layers panel. Empty means the UI names it by kind.
  std::string name;
};

/// Blends one channel of a layer result over what is beneath it.
float Blend(BlendMode mode, float under, float over) noexcept;

/**
 * A layer compiled for the per-pixel loop.
 *
 * Holds the adjustment tables plus the mix, so the whole layer is one call in
 * the inner loop rather than an adjustment pass followed by a blend pass.
 */
class CompiledLayer {
 public:
  /// The frame size is needed to compile the mask, which is described in
  /// fractions of the document rather than in pixels.
  CompiledLayer(const Layer& layer, int width, int height, const MaskBuffer* raster = nullptr);

  /// True when the layer would leave every pixel exactly as it found it.
  bool transparent() const noexcept { return transparent_; }

  void Apply(float& r, float& g, float& b, float& a, int x, int y) const noexcept;

 private:
  LayerKind kind_ = LayerKind::kAdjustment;
  FillKind fill_ = FillKind::kTransparent;
  /// Converted to the working space once, so the loop is a blend and no more.
  float fill_color_[3] = {1.0f, 1.0f, 1.0f};
  CompiledAdjustments adjustments_;
  CompiledMask mask_;
  BlendMode blend_ = BlendMode::kNormal;
  float opacity_ = 1.0f;
  bool transparent_ = false;
  /// True when the mix is a plain replacement, which skips the blend entirely.
  bool passthrough_ = true;
};

}  // namespace photoy
