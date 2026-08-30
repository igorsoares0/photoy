#pragma once

#include "image/image_buffer.h"
#include "image/rect.h"
#include "jobs/cancellation.h"

namespace photoy {

struct FitResult {
  int width = 0;
  int height = 0;
  /// Target width divided by source width, in the range (0, 1].
  double scale = 1.0;
};

/// Largest size that fits inside the box while keeping the aspect ratio. Never
/// larger than the source: the engine does not invent detail for a preview.
FitResult FitInside(int source_width, int source_height, int max_width, int max_height) noexcept;

/**
 * Area-averaged downscale of working-space pixels.
 *
 * A box filter is the right default because previews are always reductions,
 * where averaging every contributing source pixel avoids the aliasing a
 * bilinear tap leaves on fine detail. Running on working-space pixels means the
 * averaging happens in linear light, which is the only way a downscale keeps
 * the brightness of a high-contrast edge honest.
 *
 * Alpha is premultiplied before averaging and restored afterwards, so
 * transparent regions do not bleed their colour into the visible edge.
 */
Image16 DownscaleBox(const Image16& source, const Rect& region, int target_width,
                     int target_height, const CancellationTokenPtr& token);

inline Image16 DownscaleBox(const Image16& source, int target_width, int target_height) {
  return DownscaleBox(source, Rect{0, 0, source.width(), source.height()}, target_width,
                      target_height, NeverCancelled());
}

/// Downscales to fit the box, or clones when the source already fits.
Image16 ResizeToFit(const Image16& source, int max_width, int max_height, double* out_scale);

}  // namespace photoy
