#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "decoder/decoder.h"
#include "jobs/cancellation.h"

namespace photoy {

/**
 * A browsing-sized copy of a photograph, as JPEG bytes.
 *
 * JPEG rather than pixels because a thumbnail's whole life is being stored and
 * shown: a 256-pixel frame is 256 KB of RGBA and around 15 KB encoded, and the
 * side that displays it is a browser, which decodes JPEG for free. Storing
 * pixels would mean paying seventeen times the disk and the bridge for nothing.
 */
struct Thumbnail {
  std::vector<std::uint8_t> jpeg;
  /// Size of the thumbnail itself.
  int width = 0;
  int height = 0;
  /// Size of the photograph it was made from, upright.
  int source_width = 0;
  int source_height = 0;
  ImageFormat format = ImageFormat::kUnknown;
  /**
   * Whether the camera's own preview was used rather than a full decode.
   *
   * Reported because it is the difference between a folder of raw files
   * browsing in milliseconds and browsing in seconds, and because a preview is
   * the camera's rendering rather than ours - close, never identical.
   */
  bool embedded = false;
};

/**
 * Reads a file and produces a thumbnail no larger than `max_side`.
 *
 * Deliberately not a Document: browsing a folder must not put five hundred
 * photographs in memory, and nothing here needs an edit stack. A raw file is
 * asked for its embedded preview first and only decoded in full when there
 * isn't one.
 */
Thumbnail MakeThumbnail(const std::string& utf8_path, int max_side,
                        const CancellationTokenPtr& token = NeverCancelled());

/// Largest side a thumbnail may be asked for. Past this it is not a thumbnail.
inline constexpr int kMaxThumbnailSide = 1024;

}  // namespace photoy
