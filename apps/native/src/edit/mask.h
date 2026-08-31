#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace photoy {

/**
 * A painted or generated mask: one continuous 8-bit channel.
 *
 * Continuous rather than binary because that is what a segmentation model
 * actually produces - the spike in `spikes/ai` measured seven per cent of
 * pixels at intermediate values, which is the soft edge around the subject.
 * Treating it as a selection would throw exactly that away.
 */
struct MaskBuffer {
  int width = 0;
  int height = 0;
  std::vector<std::uint8_t> coverage;

  bool empty() const noexcept { return width <= 0 || height <= 0; }
  std::uint8_t At(int x, int y) const noexcept {
    return coverage[static_cast<std::size_t>(y) * width + x];
  }
};

/// Bilinear resample of a mask, for fitting one to a preview.
MaskBuffer Resize(const MaskBuffer& source, int width, int height);

/**
 * How a mask decides where its layer applies.
 *
 * These are described rather than painted: a gradient is a handful of numbers,
 * so it costs nothing to store, nothing to carry into a project, and it
 * evaluates at whatever resolution the render happens to want. Painted masks
 * are pixels and will need the container's `masks/` directory; these do not.
 */
enum class MaskKind { kNone, kLinear, kRadial, kRaster };

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

  /**
   * Levels on the coverage: below `low` nothing, above `high` everything.
   *
   * A segmentation model does not return a selection, it returns confidence,
   * and shipping that confidence raw is what puts a halo around hair and leaves
   * faint ghosts of the background floating in the frame. These two numbers are
   * the black point and the white point of that confidence, so raising `low`
   * discards what the model was never sure of and lowering `high` firms up what
   * it was. Identity is 0 and 1, which is what every other mask kind wants.
   */
  float low = 0.0f;
  float high = 1.0f;

  /// kRaster: which stored buffer this refers to. Zero means none.
  std::uint64_t raster = 0;
  /**
   * Document size the raster was generated for.
   *
   * A crop or a rotation afterwards moves every pixel underneath it, so rather
   * than stretch the mask into something quietly wrong the engine compares
   * these and reports the mask as stale.
   */
  int raster_width = 0;
  int raster_height = 0;

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
  /// `raster` may be null; a raster mask without its buffer is simply open.
  CompiledMask(const Mask& mask, int width, int height, const MaskBuffer* raster = nullptr);

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
  /// Precomputed levels: coverage becomes (coverage - low_) * levels_scale_.
  bool levelled_ = false;
  float low_ = 0.0f;
  float levels_scale_ = 1.0f;
  const MaskBuffer* raster_ = nullptr;
};

}  // namespace photoy
