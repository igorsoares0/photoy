#include "decoder/decoder.h"

#include "core/error.h"
#include "decoder/format_sniffer.h"

namespace photoy {

DecodedImage Decode(const std::vector<std::uint8_t>& bytes, ImageFormat* out_format) {
  const ImageFormat format = SniffFormat(bytes);
  if (out_format != nullptr) *out_format = format;

  switch (format) {
    case ImageFormat::kJpeg: return DecodeJpeg(bytes);
    case ImageFormat::kPng: return DecodePng(bytes);
    case ImageFormat::kTiff: return DecodeTiff(bytes);
    case ImageFormat::kWebp: return DecodeWebp(bytes);
    case ImageFormat::kUnknown: break;
  }
  throw EngineException(error_code::kUnsupportedFormat, "Unsupported image format",
                        "no decoder matched the file signature");
}

}  // namespace photoy
