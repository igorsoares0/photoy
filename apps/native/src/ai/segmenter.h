#pragma once

#include "ai/model_manager.h"
#include "edit/mask.h"
#include "image/image_buffer.h"
#include "jobs/cancellation.h"

namespace photoy::ai {

/**
 * Turns a photograph into a coverage mask over its subject.
 *
 * The cost does not depend on how large the photograph is: the model always
 * sees a small square, and everything before and after it is a resample. That
 * inverts the economics of the rest of this engine, where work is proportional
 * to megapixels, and it is why an inference on a fifty-megapixel file costs
 * about what one on a five-megapixel file costs.
 */
MaskBuffer Segment(const Image16& working, Session& session, const CancellationTokenPtr& token);

}  // namespace photoy::ai
