#include "image/image_buffer.h"

namespace photoy {

Image16 Widen(const Image8& source) {
  if (source.empty()) return {};
  Image16 result = Image16::Create(source.width(), source.height());
  for (int y = 0; y < source.height(); ++y) {
    const std::uint8_t* in = source.Row(y);
    std::uint16_t* out = result.Row(y);
    for (std::size_t i = 0; i < source.samples_per_row(); ++i) {
      out[i] = Widen8To16(in[i]);
    }
  }
  return result;
}

}  // namespace photoy
