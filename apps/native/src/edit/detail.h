#pragma once

#include "edit/adjustments.h"
#include "edit/mask.h"
#include "image/image_buffer.h"
#include "jobs/cancellation.h"

namespace photoy {

/**
 * Sharpening and clarity: the two adjustments that have to look at neighbours.
 *
 * Everything else in this engine is a function of one pixel, which is what lets
 * it be fused into the colour conversion and cost one pass. These two cannot
 * be: they are the difference between a pixel and a blurred version of what
 * surrounds it, so they need a pass of their own over a buffer.
 *
 * Both act on luminance rather than on each channel. Sharpening the channels
 * separately puts colour fringes on every edge, and neither control is about
 * colour - they are about how much local contrast the picture has.
 *
 * `scale` is how much of the document one rendered pixel covers, so a radius
 * means the same distance in the photograph at any zoom.
 */
void ApplyDetail(Image16& image, const Adjustments& adjustments, const CompiledMask& mask,
                 float opacity, double scale, const CancellationTokenPtr& token);

/// True when the adjustments would leave the picture exactly as they found it.
bool DetailIsNeutral(const Adjustments& adjustments) noexcept;

}  // namespace photoy
