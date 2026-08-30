#include "decoder/jpeg_marker.h"

namespace photoy {

void ForEachJpegSegment(
    const std::vector<std::uint8_t>& bytes,
    const std::function<bool(std::uint8_t, const std::uint8_t*, std::size_t)>& visit) {
  if (bytes.size() < 4 || bytes[0] != 0xFF || bytes[1] != 0xD8) return;

  std::size_t offset = 2;
  while (offset + 4 <= bytes.size()) {
    if (bytes[offset] != 0xFF) return;

    const std::uint8_t marker = bytes[offset + 1];
    // Standalone markers carry no length field.
    if (marker == 0xD8 || marker == 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
      offset += 2;
      continue;
    }
    if (marker == 0xDA || marker == 0xD9) return;  // start of scan, or end of image

    const std::size_t length = (static_cast<std::size_t>(bytes[offset + 2]) << 8) | bytes[offset + 3];
    if (length < 2 || offset + 2 + length > bytes.size()) return;

    if (!visit(marker, bytes.data() + offset + 4, length - 2)) return;
    offset += 2 + length;
  }
}

}  // namespace photoy
