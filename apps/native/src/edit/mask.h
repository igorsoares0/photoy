#pragma once

#include <string>

namespace photoy {

/**
 * How a mask decides where its layer applies.
 *
 * These are described rather than painted: a gradient is a handful of numbers,
 * so it costs nothing to store, nothing to carry into a project, and it
 * evaluates at whatever resolution the render happens to want. Painted masks
 * are pixels and will need the container's `masks/` directory; these do not.
 */
enum class MaskKind { kNone, kLinear, kRadial };

const char* MaskKindName(MaskKind kind) noexcept;
MaskKind MaskKindFromName(const std::string& name) noexcept;

/**
 * A parametric mask.
 *
 * Coordinates are fractions of the document, so a mask keeps its place when the
 * preview resolution changes. Distances use the shorter side as their unit,
 * which is what keeps a radial mask a circle on a frame that is not square.
 */
struct Mask {
  MaskKind kind = MaskKind::kNone;
  /// Midpoint of the transition, as a fraction of the document.
  float x = 0.5f;
  float y = 0.5f;
  /// Direction of a linear gradient, in radians. Zero points down the frame.
  float angle = 0.0f;
  /// Radius of a radial mask, in units of the shorter side.
  float radius = 0.35f;
  /// Width of the transition, in the same units. Zero is a hard edge.
  float feather = 0.25f;
  /// Swaps which side the layer applies to.
  bool invert = false;

  bool IsNone() const noexcept { return kind == MaskKind::kNone; }
  bool operator==(const Mask& other) const noexcept;
  bool operator!=(const Mask& other) const noexcept { return !(*this == other); }
};

/**
 * A mask compiled for the per-pixel loop.
 *
 * Holds the frame's aspect so that evaluation is a couple of multiplies and a
 * smoothstep, with nothing to look up.
 */
class CompiledMask {
 public:
  CompiledMask() = default;
  CompiledMask(const Mask& mask, int width, int height);

  /// True when the mask lets everything through, and can be skipped entirely.
  bool open() const noexcept { return open_; }

  /// Coverage at a pixel, from 0 (masked out) to 1 (fully applied).
  float At(int x, int y) const noexcept;

 private:
  bool open_ = true;
  MaskKind kind_ = MaskKind::kNone;
  bool invert_ = false;
  float centre_x_ = 0.0f;
  float centre_y_ = 0.0f;
  float direction_x_ = 0.0f;
  float direction_y_ = 1.0f;
  float radius_ = 0.0f;
  float feather_ = 0.0f;
  /// Pixel-to-unit scale on each axis, with the shorter side as the unit.
  float scale_x_ = 0.0f;
  float scale_y_ = 0.0f;
};

}  // namespace photoy
