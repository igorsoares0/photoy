#include <csetjmp>
#include <cstdio>
#include <string>
#include <vector>

#include <jpeglib.h>

#ifdef _MSC_VER
// setjmp is the error-handling idiom both libjpeg and libpng document, and the
// guarded scopes below deliberately hold no objects with destructors.
#pragma warning(disable : 4611)
#pragma warning(disable : 4324)
#endif

#include "core/error.h"
#include "decoder/decoder.h"
#include "decoder/exif.h"
#include "decoder/jpeg_marker.h"

namespace photoy {
namespace {

struct JpegErrorManager {
  jpeg_error_mgr base;
  std::jmp_buf escape;
  char message[JMSG_LENGTH_MAX];
};

void OnFatalError(j_common_ptr info) {
  auto* manager = reinterpret_cast<JpegErrorManager*>(info->err);
  (*info->err->format_message)(info, manager->message);
  std::longjmp(manager->escape, 1);
}

/// libjpeg's default handler prints to stderr; corrupt-but-decodable files are
/// common enough that we swallow warnings rather than pollute the log.
void OnWarning(j_common_ptr, int) {}

void CmykRowToRgba(const std::uint8_t* source, std::uint8_t* target, int width, bool adobe_inverted) {
  for (int x = 0; x < width; ++x) {
    const std::uint8_t* pixel = source + static_cast<std::size_t>(x) * 4;
    // Adobe writes CMYK inverted; libjpeg reports that via saw_Adobe_marker.
    const int c = adobe_inverted ? pixel[0] : 255 - pixel[0];
    const int m = adobe_inverted ? pixel[1] : 255 - pixel[1];
    const int y = adobe_inverted ? pixel[2] : 255 - pixel[2];
    const int k = adobe_inverted ? pixel[3] : 255 - pixel[3];
    std::uint8_t* out = target + static_cast<std::size_t>(x) * kChannels;
    out[0] = static_cast<std::uint8_t>(c * k / 255);
    out[1] = static_cast<std::uint8_t>(m * k / 255);
    out[2] = static_cast<std::uint8_t>(y * k / 255);
    out[3] = 255;
  }
}

/**
 * Reassembles an ICC profile from the APP2 segments that carry it.
 *
 * A profile larger than a segment is split across several, each tagged with its
 * position, so the chunks are collected and concatenated in order.
 */
color::IccBytes ExtractIcc(const std::vector<std::uint8_t>& bytes) {
  static constexpr char kIccPrefix[] = "ICC_PROFILE";
  static constexpr std::size_t kHeaderLength = 14;  // 12-byte tag, sequence, count

  std::vector<color::IccBytes> chunks;
  std::size_t total = 0;

  ForEachJpegSegment(bytes, [&](std::uint8_t marker, const std::uint8_t* payload,
                                std::size_t length) {
    if (marker != 0xE2 || length <= kHeaderLength) return true;
    if (std::memcmp(payload, kIccPrefix, sizeof(kIccPrefix)) != 0) return true;

    const std::size_t sequence = payload[12];
    const std::size_t count = payload[13];
    if (sequence == 0 || count == 0 || sequence > count) return true;
    if (chunks.size() < count) chunks.resize(count);

    chunks[sequence - 1].assign(payload + kHeaderLength, payload + length);
    total += length - kHeaderLength;
    return true;
  });

  color::IccBytes profile;
  profile.reserve(total);
  for (const color::IccBytes& chunk : chunks) {
    if (chunk.empty()) return {};  // a missing chunk makes the profile unusable
    profile.insert(profile.end(), chunk.begin(), chunk.end());
  }
  return profile;
}

}  // namespace

DecodedImage DecodeJpeg(const std::vector<std::uint8_t>& bytes) {
  jpeg_decompress_struct info {};
  JpegErrorManager error_manager {};

  info.err = jpeg_std_error(&error_manager.base);
  error_manager.base.error_exit = &OnFatalError;
  error_manager.base.emit_message = &OnWarning;

  // Everything that must survive the longjmp lives outside the guarded scope.
  Image8 pixels;
  bool is_cmyk = false;
  bool adobe_inverted = false;
  std::string failure;

  if (setjmp(error_manager.escape) == 0) {
    jpeg_create_decompress(&info);
    jpeg_mem_src(&info, bytes.data(), static_cast<unsigned long>(bytes.size()));
    jpeg_read_header(&info, TRUE);

    is_cmyk = info.jpeg_color_space == JCS_CMYK || info.jpeg_color_space == JCS_YCCK;
    adobe_inverted = info.saw_Adobe_marker != 0;
    info.out_color_space = is_cmyk ? JCS_CMYK : JCS_EXT_RGBA;

    jpeg_start_decompress(&info);
    pixels = Image8::Create(static_cast<int>(info.output_width),
                            static_cast<int>(info.output_height));

    const int source_components = is_cmyk ? 4 : kChannels;
    std::vector<std::uint8_t> scanline(static_cast<std::size_t>(info.output_width) *
                                       static_cast<std::size_t>(source_components));

    while (info.output_scanline < info.output_height) {
      const int row = static_cast<int>(info.output_scanline);
      JSAMPROW target = is_cmyk ? scanline.data() : pixels.Row(row);
      jpeg_read_scanlines(&info, &target, 1);
      if (is_cmyk) {
        CmykRowToRgba(scanline.data(), pixels.Row(row), pixels.width(), adobe_inverted);
      }
    }

    jpeg_finish_decompress(&info);
    jpeg_destroy_decompress(&info);
  } else {
    failure = error_manager.message;
    jpeg_destroy_decompress(&info);
  }

  if (!failure.empty()) {
    throw EngineException(error_code::kDecodeFailed, "Could not decode JPEG", failure);
  }

  DecodedImage decoded;
  decoded.bit_depth = 8;  // libjpeg-turbo is built for 8-bit samples here
  decoded.has_alpha = false;
  decoded.icc = ExtractIcc(bytes);
  decoded.orientation = ReadOrientation(ExtractJpegExif(bytes));
  decoded.pixels = ApplyOrientation(Widen(pixels), decoded.orientation);
  return decoded;
}

}  // namespace photoy
