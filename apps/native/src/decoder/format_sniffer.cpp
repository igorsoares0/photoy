#include "decoder/format_sniffer.h"

#include <cstring>

namespace photoy {
namespace {

bool StartsWith(const std::vector<std::uint8_t>& bytes, const std::uint8_t* prefix,
                std::size_t length) noexcept {
  return bytes.size() >= length && std::memcmp(bytes.data(), prefix, length) == 0;
}

}  // namespace

const char* FormatName(ImageFormat format) noexcept {
  switch (format) {
    case ImageFormat::kJpeg: return "jpeg";
    case ImageFormat::kPng: return "png";
    case ImageFormat::kTiff: return "tiff";
    case ImageFormat::kWebp: return "webp";
    case ImageFormat::kRaw: return "raw";
    case ImageFormat::kHeif: return "heif";
    case ImageFormat::kUnknown: break;
  }
  return "unknown";
}

ImageFormat SniffFormat(const std::vector<std::uint8_t>& bytes) noexcept {
  static const std::uint8_t kJpegMagic[] = {0xFF, 0xD8, 0xFF};
  static const std::uint8_t kPngMagic[] = {0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A};
  static const std::uint8_t kTiffLittle[] = {'I', 'I', 0x2A, 0x00};
  static const std::uint8_t kTiffBig[] = {'M', 'M', 0x00, 0x2A};

  if (StartsWith(bytes, kJpegMagic, sizeof(kJpegMagic))) return ImageFormat::kJpeg;
  if (StartsWith(bytes, kPngMagic, sizeof(kPngMagic))) return ImageFormat::kPng;
  if (StartsWith(bytes, kTiffLittle, sizeof(kTiffLittle))) return ImageFormat::kTiff;
  if (StartsWith(bytes, kTiffBig, sizeof(kTiffBig))) return ImageFormat::kTiff;

  // ISO base media, which is a whole family: bytes 4 to 8 say `ftyp` and the
  // four after that say which member. HEIC and Canon's CR3 are both in it, so
  // the brand is the only thing that tells them apart - CR3 says `crx `, and
  // falls through to the raw probe in Decode.
  if (bytes.size() >= 12 && std::memcmp(bytes.data() + 4, "ftyp", 4) == 0) {
    static const char* kHeifBrands[] = {"heic", "heix", "heim", "heis",
                                        "hevc", "hevx", "hevm", "hevs",
                                        "mif1", "msf1"};
    for (const char* brand : kHeifBrands) {
      if (std::memcmp(bytes.data() + 8, brand, 4) == 0) return ImageFormat::kHeif;
    }
  }

  // RIFF....WEBP
  if (bytes.size() >= 12 && std::memcmp(bytes.data(), "RIFF", 4) == 0 &&
      std::memcmp(bytes.data() + 8, "WEBP", 4) == 0) {
    return ImageFormat::kWebp;
  }
  return ImageFormat::kUnknown;
}

ImageFormat FormatFromName(const std::string& name) noexcept {
  if (name == "jpeg" || name == "jpg" || name == "jpe") return ImageFormat::kJpeg;
  if (name == "png") return ImageFormat::kPng;
  if (name == "tiff" || name == "tif") return ImageFormat::kTiff;
  if (name == "webp") return ImageFormat::kWebp;
  return ImageFormat::kUnknown;
}

}  // namespace photoy
