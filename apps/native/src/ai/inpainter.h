#pragma once

#include "ai/model_manager.h"
#include "edit/mask.h"
#include "image/image_buffer.h"
#include "image/rect.h"
#include "jobs/cancellation.h"

namespace photoy::ai {

/**
 * What the model invented, and where in the document it belongs.
 *
 * The pixels are the model's own output, at the model's own resolution and in
 * sRGB, with no blending applied. Keeping the blend out of here is what lets
 * the marked area be trimmed afterwards without the model running again, and it
 * means a stored patch holds only what the model actually knows.
 */
struct Patch {
  Rect region;
  Image8 pixels;
};

/**
 * Chooses the window the model works on.
 *
 * The model's input is fixed at 512 x 512, so the choice is which part of the
 * photograph to spend it on. A window around the mark rather than the whole
 * frame means the cost is set by the size of what is being removed and not by
 * the megapixels, and it means every pixel outside the window is left exactly
 * as it was rather than surviving a round trip through a resample.
 *
 * The margin exists because inpainting is extrapolation from surroundings: a
 * window cut tight to the mark would leave the model nothing to work from.
 */
Rect InpaintWindow(const Rect& marked, int image_width, int image_height);

/// The bounding box of everything the mask marks, or an empty rect.
Rect MarkedBounds(const MaskBuffer& mask) noexcept;

/**
 * Fills what the mask marks, using what surrounds it.
 *
 * `mask` is in document coordinates and is resampled to the image if it does
 * not already match. What comes back covers the window only.
 */
Patch Inpaint(const Image16& working, const MaskBuffer& mask, Session& session,
              const CancellationTokenPtr& token);

}  // namespace photoy::ai
