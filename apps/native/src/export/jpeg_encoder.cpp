#include <csetjmp>
#include <algorithm>
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
#include "export/encoder.h"

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

void OnWarning(j_common_ptr, int) {}

/// Writes the ICC profile as one or more APP2 segments, each tagged with its
/// position so a reader can put them back together.
void WriteIccSegments(jpeg_compress_struct& info, const color::IccBytes& icc) {
  static constexpr char kTag[] = "ICC_PROFILE";
  static constexpr std::size_t kHeaderLength = 14;
  static constexpr std::size_t kMaxSegment = 65533;
  static constexpr std::size_t kMaxChunk = kMaxSegment - kHeaderLength;

  if (icc.empty()) return;
  const std::size_t chunks = (icc.size() + kMaxChunk - 1) / kMaxChunk;
  if (chunks > 255) return;  // more than the sequence byte can address

  for (std::size_t index = 0; index < chunks; ++index) {
    const std::size_t offset = index * kMaxChunk;
    const std::size_t length = std::min(kMaxChunk, icc.size() - offset);

    std::vector<std::uint8_t> segment;
    segment.reserve(kHeaderLength + length);
    segment.insert(segment.end(), kTag, kTag + sizeof(kTag));  // includes the NUL
    segment.push_back(static_cast<std::uint8_t>(index + 1));
    segment.push_back(static_cast<std::uint8_t>(chunks));
    segment.insert(segment.end(), icc.begin() + static_cast<std::ptrdiff_t>(offset),
                   icc.begin() + static_cast<std::ptrdiff_t>(offset + length));

    jpeg_write_marker(&info, JPEG_APP0 + 2, segment.data(),
                      static_cast<unsigned int>(segment.size()));
  }
}

}  // namespace

std::vector<std::uint8_t> EncodeJpeg(const OutputImage& image, const EncodeOptions& options) {
  if (image.bit_depth != 8) {
    throw EngineException(error_code::kEncodeFailed, "JPEG requires 8-bit samples",
                          std::to_string(image.bit_depth) + " bits requested");
  }
  jpeg_compress_struct info {};
  JpegErrorManager error_manager {};
  info.err = jpeg_std_error(&error_manager.base);
  error_manager.base.error_exit = &OnFatalError;
  error_manager.base.emit_message = &OnWarning;

  unsigned char* output = nullptr;
  unsigned long output_size = 0;
  std::string failure;

  if (setjmp(error_manager.escape) == 0) {
    jpeg_create_compress(&info);
    jpeg_mem_dest(&info, &output, &output_size);

    info.image_width = static_cast<JDIMENSION>(image.width);
    info.image_height = static_cast<JDIMENSION>(image.height);
    info.input_components = kChannels;
    info.in_color_space = JCS_EXT_RGBA;  // JPEG has no alpha; libjpeg drops it
    jpeg_set_defaults(&info);
    jpeg_set_quality(&info, options.quality, TRUE);
    jpeg_start_compress(&info, TRUE);

    if (!options.exif.empty()) {
      // APP1 payload is the "Exif\0\0" identifier followed by the TIFF block.
      std::vector<std::uint8_t> segment;
      segment.reserve(options.exif.size() + 6);
      const std::uint8_t prefix[] = {'E', 'x', 'i', 'f', 0, 0};
      segment.insert(segment.end(), prefix, prefix + sizeof(prefix));
      segment.insert(segment.end(), options.exif.begin(), options.exif.end());
      if (segment.size() <= 65533) {
        jpeg_write_marker(&info, JPEG_APP0 + 1, segment.data(),
                          static_cast<unsigned int>(segment.size()));
      }
    }
    // EXIF first, then ICC: readers expect APP1 to precede APP2.
    WriteIccSegments(info, options.icc);

    const auto* base = static_cast<const std::uint8_t*>(image.data);
    while (info.next_scanline < info.image_height) {
      JSAMPROW row = const_cast<JSAMPROW>(
          reinterpret_cast<const JSAMPLE*>(base + info.next_scanline * image.stride));
      jpeg_write_scanlines(&info, &row, 1);
    }

    jpeg_finish_compress(&info);
    jpeg_destroy_compress(&info);
  } else {
    failure = error_manager.message;
    jpeg_destroy_compress(&info);
  }

  std::vector<std::uint8_t> bytes;
  if (output != nullptr) {
    if (failure.empty()) bytes.assign(output, output + output_size);
    std::free(output);
  }
  if (!failure.empty()) {
    throw EngineException(error_code::kEncodeFailed, "Could not encode JPEG", failure);
  }
  return bytes;
}

}  // namespace photoy
