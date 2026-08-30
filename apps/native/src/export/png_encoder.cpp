#ifdef _MSC_VER
// setjmp is the error-handling idiom libpng documents, and the guarded scope
// below deliberately holds no objects with destructors.
#pragma warning(disable : 4611)
#endif

#include <csetjmp>
#include <cstdint>
#include <string>
#include <vector>

#include <png.h>

#include "core/error.h"
#include "export/encoder.h"

namespace photoy {
namespace {

void WriteToVector(png_structp png, png_bytep data, png_size_t length) {
  auto* sink = static_cast<std::vector<std::uint8_t>*>(png_get_io_ptr(png));
  sink->insert(sink->end(), data, data + length);
}

void FlushVector(png_structp) {}

void OnError(png_structp png, png_const_charp message) {
  auto* failure = static_cast<std::string*>(png_get_error_ptr(png));
  if (failure != nullptr) *failure = message;
  png_longjmp(png, 1);
}

void OnWarning(png_structp, png_const_charp) {}

bool IsLittleEndian() noexcept {
  const std::uint16_t probe = 1;
  return *reinterpret_cast<const std::uint8_t*>(&probe) == 1;
}

}  // namespace

std::vector<std::uint8_t> EncodePng(const OutputImage& image, const EncodeOptions& options) {
  std::string failure;
  png_structp png = png_create_write_struct(PNG_LIBPNG_VER_STRING, &failure, &OnError, &OnWarning);
  if (png == nullptr) {
    throw EngineException(error_code::kEncodeFailed, "Could not encode PNG",
                          "png_create_write_struct failed");
  }
  png_infop info = png_create_info_struct(png);
  if (info == nullptr) {
    png_destroy_write_struct(&png, nullptr);
    throw EngineException(error_code::kEncodeFailed, "Could not encode PNG",
                          "png_create_info_struct failed");
  }

  std::vector<std::uint8_t> bytes;
  bool wrote = false;

  if (setjmp(png_jmpbuf(png)) == 0) {
    png_set_write_fn(png, &bytes, &WriteToVector, &FlushVector);
    png_set_IHDR(png, info, static_cast<png_uint_32>(image.width),
                 static_cast<png_uint_32>(image.height), image.bit_depth, PNG_COLOR_TYPE_RGBA,
                 PNG_INTERLACE_NONE, PNG_COMPRESSION_TYPE_DEFAULT, PNG_FILTER_TYPE_DEFAULT);

    if (!options.icc.empty()) {
      png_set_iCCP(png, info, "Photoy", PNG_COMPRESSION_TYPE_BASE, options.icc.data(),
                   static_cast<png_uint_32>(options.icc.size()));
    }
    png_write_info(png, info);

    // PNG stores 16-bit samples big-endian; the buffer is in host order.
    if (image.bit_depth == 16 && IsLittleEndian()) png_set_swap(png);

    const auto* base = static_cast<const std::uint8_t*>(image.data);
    for (int y = 0; y < image.height; ++y) {
      png_write_row(png, const_cast<png_bytep>(base + static_cast<std::size_t>(y) * image.stride));
    }
    png_write_end(png, nullptr);
    wrote = true;
  }

  png_destroy_write_struct(&png, &info);

  if (!wrote) {
    throw EngineException(error_code::kEncodeFailed, "Could not encode PNG",
                          failure.empty() ? "libpng aborted" : failure);
  }
  return bytes;
}

}  // namespace photoy
