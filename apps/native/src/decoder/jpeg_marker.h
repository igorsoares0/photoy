#pragma once

#include <cstdint>
#include <functional>
#include <vector>

namespace photoy {

/**
 * Walks the marker segments of a JPEG.
 *
 * Both EXIF and ICC live in application segments before the scan, and each is
 * spread over one or more of them, so the walk is shared rather than written
 * once per metadata kind.
 *
 * `visit` receives the marker byte and its payload, and returns false to stop.
 * Iteration ends at the start of scan, where entropy-coded data begins.
 */
void ForEachJpegSegment(
    const std::vector<std::uint8_t>& bytes,
    const std::function<bool(std::uint8_t marker, const std::uint8_t* payload, std::size_t length)>&
        visit);

}  // namespace photoy
