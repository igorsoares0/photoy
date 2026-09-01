#pragma once

#include "ai/model_manager.h"
#include "image/image_buffer.h"
#include "jobs/cancellation.h"

namespace photoy::ai {

/**
 * Removes noise, using the surroundings to tell grain from detail.
 *
 * Unlike the other two models here, this one takes whatever size it is given -
 * it is fully convolutional, with only a padding requirement - so the choice is
 * not which window to spend a fixed input on, but how much of the photograph to
 * hand it at once.
 */
Image16 Denoise(const Image16& working, Session& session, const CancellationTokenPtr& token);

}  // namespace photoy::ai
