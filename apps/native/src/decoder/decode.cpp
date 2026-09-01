#include "decoder/decoder.h"

#include "core/error.h"
#include "decoder/format_sniffer.h"

namespace photoy {

DecodedImage Decode(const std::vector<std::uint8_t>& bytes, ImageFormat* out_format,
                    const RawSettings& settings) {
  ImageFormat format = SniffFormat(bytes);

  // CR2, NEF, ARW, DNG and PEF are TIFF containers, so the magic number cannot
  // tell them from an ordinary TIFF, and the rest - RAF, CR3, RW2, X3F - carry
  // signatures the sniffer has never heard of. Both land here, and both are
  // settled by asking LibRaw to parse the header.
  if (format == ImageFormat::kTiff || format == ImageFormat::kUnknown) {
    if (IsRaw(bytes)) format = ImageFormat::kRaw;
  }
  if (out_format != nullptr) *out_format = format;

  switch (format) {
    case ImageFormat::kJpeg: return DecodeJpeg(bytes);
    case ImageFormat::kPng: return DecodePng(bytes);
    case ImageFormat::kTiff: return DecodeTiff(bytes);
    case ImageFormat::kWebp: return DecodeWebp(bytes);
    case ImageFormat::kRaw: return DecodeRaw(bytes, settings);
    case ImageFormat::kHeif: return DecodeHeif(bytes);
    case ImageFormat::kUnknown: break;
  }
  throw EngineException(error_code::kUnsupportedFormat, "Unsupported image format",
                        "no decoder matched the file signature");
}

}  // namespace photoy
