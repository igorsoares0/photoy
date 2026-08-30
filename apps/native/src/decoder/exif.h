#pragma once

#include <cstdint>
#include <vector>

#include "image/orientation.h"

namespace photoy {

/// The raw EXIF payload of a JPEG APP1 segment, without the "Exif\0\0" prefix.
/// Empty when the file carried no EXIF.
using ExifBlob = std::vector<std::uint8_t>;

/// Extracts the EXIF payload from a JPEG by walking its marker segments.
ExifBlob ExtractJpegExif(const std::vector<std::uint8_t>& jpeg_bytes);

/// Reads tag 0x0112 out of a TIFF-structured EXIF blob. Returns kTopLeft when
/// the tag is absent or the blob is malformed - an unreadable orientation is
/// not a reason to fail an otherwise valid decode.
Orientation ReadOrientation(const ExifBlob& exif) noexcept;

/// Rewrites tag 0x0112 to 1 in place. Exported pixels are always upright, so
/// carrying the capture orientation forward would make viewers rotate twice.
void NormalizeOrientationTag(ExifBlob& exif) noexcept;

}  // namespace photoy
