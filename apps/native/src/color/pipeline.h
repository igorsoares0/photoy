#pragma once

#include <algorithm>

#include "color/output.h"
#include "color/profile.h"
#include "core/error.h"
#include "image/image_buffer.h"
#include "jobs/cancellation.h"

namespace photoy::color {

/**
 * Conversions between a file's colour space, the engine's working space, and
 * whatever a preview or an export needs.
 *
 * This is the "Color Management" stage the pipeline puts immediately after
 * Decode: nothing downstream has to know what space the file was written in,
 * because by then everything is in the working space.
 */

/**
 * Converts decoded pixels into the working space.
 *
 * An invalid or missing source profile is treated as sRGB, which is the correct
 * assumption for an untagged JPEG, PNG or WebP.
 */
Image16 ToWorking(const Image16& source, const Profile& source_profile);

/// Rows converted between cancellation checks. Large enough that the per-call
/// overhead stays negligible, small enough to stop within a frame.
inline constexpr int kBandHeight = 64;

/**
 * Converts working pixels into an output space, band by band.
 *
 * `pre` runs on each pixel while it is still in the working space, which is
 * where adjustments belong. It is a template parameter rather than an interface
 * so that the neutral case compiles away to nothing.
 */
template <typename Out, typename PreProcess>
void ConvertBanded(const Image16& working, TImageBuffer<Out>& result, OutputSpace space,
                   const CancellationTokenPtr& token, const PreProcess& pre,
                   bool flatten = false) {
  const OutputConverter& converter = ConverterFor(space);
  for (int y = 0; y < working.height(); y += kBandHeight) {
    if (token->cancelled()) {
      throw EngineException(error_code::kCancelled, "Render cancelled", "superseded");
    }
    converter.ConvertRows(working, result, y, std::min(kBandHeight, working.height() - y), pre,
                          flatten);
  }
}

/// Converts working pixels to 8 bits in an output space, for screen or file.
Image8 ToOutput8(const Image16& working, OutputSpace space,
                 const CancellationTokenPtr& token = NeverCancelled());

/// Converts working pixels to 16 bits, for a PNG or TIFF export that keeps them.
Image16 ToOutput16(const Image16& working, OutputSpace space,
                   const CancellationTokenPtr& token = NeverCancelled());

}  // namespace photoy::color
