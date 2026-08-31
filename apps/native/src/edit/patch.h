#pragma once

#include <cstdint>

#include "image/image_buffer.h"
#include "image/rect.h"

namespace photoy {

/**
 * Pixels a model invented, and where in the document they belong.
 *
 * Held as the model produced them - 8-bit sRGB at the model's own resolution -
 * rather than as working-space pixels resampled to the document. That is the
 * whole of what the model actually knows, so storing more would be storing
 * interpolation and calling it detail, and it keeps a patch small enough to sit
 * in the project file as an ordinary PNG somebody can open.
 *
 * The region is in natural document coordinates: the crop and the orientation
 * decide where a patch lands, a resize does not, for the same reason a raster
 * mask is measured against the natural size.
 */
struct PatchBuffer {
  Rect region;
  /// The natural document size the region was measured against.
  int document_width = 0;
  int document_height = 0;
  /// sRGB, 8 bits, at whatever resolution the model works in.
  Image8 pixels;

  bool empty() const noexcept { return region.empty() || pixels.empty(); }
};

/**
 * A patch resampled and converted for one render.
 *
 * The conversion out of sRGB and the resample to the render's scale are the
 * expensive half, and neither changes while a slider moves, so this is cached
 * beside the document exactly as a fitted mask is.
 */
struct FittedPatch {
  /// Position in render coordinates.
  int x = 0;
  int y = 0;
  Image16 pixels;

  bool empty() const noexcept { return pixels.empty(); }
};

/// Converts and resamples a patch for a render of the given document size.
FittedPatch FitPatch(const PatchBuffer& patch, int render_width, int render_height);

}  // namespace photoy
