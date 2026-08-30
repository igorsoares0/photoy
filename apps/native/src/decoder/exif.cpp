#include "decoder/exif.h"

#include "decoder/jpeg_marker.h"

#include <cstring>

namespace photoy {
namespace {

constexpr std::uint16_t kOrientationTag = 0x0112;

std::uint16_t ReadU16(const std::uint8_t* p, bool little_endian) noexcept {
  return little_endian ? static_cast<std::uint16_t>(p[0] | (p[1] << 8))
                       : static_cast<std::uint16_t>((p[0] << 8) | p[1]);
}

std::uint32_t ReadU32(const std::uint8_t* p, bool little_endian) noexcept {
  if (little_endian) {
    return static_cast<std::uint32_t>(p[0]) | (static_cast<std::uint32_t>(p[1]) << 8) |
           (static_cast<std::uint32_t>(p[2]) << 16) | (static_cast<std::uint32_t>(p[3]) << 24);
  }
  return (static_cast<std::uint32_t>(p[0]) << 24) | (static_cast<std::uint32_t>(p[1]) << 16) |
         (static_cast<std::uint32_t>(p[2]) << 8) | static_cast<std::uint32_t>(p[3]);
}

}  // namespace

ExifBlob ExtractJpegExif(const std::vector<std::uint8_t>& bytes) {
  ExifBlob exif;
  ForEachJpegSegment(bytes, [&exif](std::uint8_t marker, const std::uint8_t* payload,
                                    std::size_t length) {
    static constexpr char kExifPrefix[] = "Exif\0\0";
    if (marker != 0xE1 || length <= 6 || std::memcmp(payload, kExifPrefix, 6) != 0) return true;
    exif.assign(payload + 6, payload + length);
    return false;  // the first APP1 wins; a second EXIF block is not legal
  });
  return exif;
}

Orientation ReadOrientation(const ExifBlob& exif) noexcept {
  if (exif.size() < 8) return Orientation::kTopLeft;

  bool little_endian = false;
  if (exif[0] == 'I' && exif[1] == 'I') {
    little_endian = true;
  } else if (exif[0] == 'M' && exif[1] == 'M') {
    little_endian = false;
  } else {
    return Orientation::kTopLeft;
  }
  if (ReadU16(exif.data() + 2, little_endian) != 0x002A) return Orientation::kTopLeft;

  const std::uint32_t ifd_offset = ReadU32(exif.data() + 4, little_endian);
  if (ifd_offset + 2 > exif.size()) return Orientation::kTopLeft;

  const std::uint16_t entry_count = ReadU16(exif.data() + ifd_offset, little_endian);
  for (std::uint16_t i = 0; i < entry_count; ++i) {
    const std::size_t entry = static_cast<std::size_t>(ifd_offset) + 2 + i * 12u;
    if (entry + 12 > exif.size()) break;
    if (ReadU16(exif.data() + entry, little_endian) != kOrientationTag) continue;
    // The value is a SHORT, stored inline in the first two bytes of the field.
    return OrientationFromInt(ReadU16(exif.data() + entry + 8, little_endian));
  }
  return Orientation::kTopLeft;
}

void NormalizeOrientationTag(ExifBlob& exif) noexcept {
  if (exif.size() < 8) return;

  bool little_endian = false;
  if (exif[0] == 'I' && exif[1] == 'I') little_endian = true;
  else if (exif[0] == 'M' && exif[1] == 'M') little_endian = false;
  else return;
  if (ReadU16(exif.data() + 2, little_endian) != 0x002A) return;

  const std::uint32_t ifd_offset = ReadU32(exif.data() + 4, little_endian);
  if (ifd_offset + 2 > exif.size()) return;

  const std::uint16_t entry_count = ReadU16(exif.data() + ifd_offset, little_endian);
  for (std::uint16_t i = 0; i < entry_count; ++i) {
    const std::size_t entry = static_cast<std::size_t>(ifd_offset) + 2 + i * 12u;
    if (entry + 12 > exif.size()) break;
    if (ReadU16(exif.data() + entry, little_endian) != kOrientationTag) continue;
    exif[entry + 8] = little_endian ? 1 : 0;
    exif[entry + 9] = little_endian ? 0 : 1;
    return;
  }
}

}  // namespace photoy
