#include <csetjmp>
#include <cstring>
#include <string>
#include <vector>

#include <png.h>

#ifdef _MSC_VER
// setjmp is the error-handling idiom both libjpeg and libpng document, and the
// guarded scopes below deliberately hold no objects with destructors.
#pragma warning(disable : 4611)
#pragma warning(disable : 4324)
#endif

#include "core/error.h"
#include "decoder/decoder.h"

namespace photoy {
namespace {

struct MemoryReader {
  const std::uint8_t* data;
  std::size_t size;
  std::size_t offset;
};

void ReadFromMemory(png_structp png, png_bytep target, png_size_t length) {
  auto* reader = static_cast<MemoryReader*>(png_get_io_ptr(png));
  if (reader->offset + length > reader->size) {
    png_error(png, "read past end of buffer");
    return;
  }
  std::memcpy(target, reader->data + reader->offset, length);
  reader->offset += length;
}

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

DecodedImage DecodePng(const std::vector<std::uint8_t>& bytes) {
  std::string failure;
  png_structp png = png_create_read_struct(PNG_LIBPNG_VER_STRING, &failure, &OnError, &OnWarning);
  if (png == nullptr) {
    throw EngineException(error_code::kDecodeFailed, "Could not decode PNG",
                          "png_create_read_struct failed");
  }
  png_infop info = png_create_info_struct(png);
  if (info == nullptr) {
    png_destroy_read_struct(&png, nullptr, nullptr);
    throw EngineException(error_code::kDecodeFailed, "Could not decode PNG",
                          "png_create_info_struct failed");
  }

  Image16 pixels;
  int source_bit_depth = 8;
  bool has_alpha = false;
  color::IccBytes icc;
  MemoryReader reader {bytes.data(), bytes.size(), 0};

  if (setjmp(png_jmpbuf(png)) == 0) {
    png_set_read_fn(png, &reader, &ReadFromMemory);
    png_read_info(png, info);

    const png_uint_32 width = png_get_image_width(png, info);
    const png_uint_32 height = png_get_image_height(png, info);
    const int color_type = png_get_color_type(png, info);
    source_bit_depth = png_get_bit_depth(png, info);
    has_alpha = (color_type & PNG_COLOR_MASK_ALPHA) != 0 ||
                png_get_valid(png, info, PNG_INFO_tRNS) != 0;

    // A PNG may carry its own ICC profile; without one the file is sRGB by
    // convention, which is what an invalid profile falls back to downstream.
    png_charp profile_name = nullptr;
    int compression = 0;
    png_bytep profile_data = nullptr;
    png_uint_32 profile_length = 0;
    if (png_get_iCCP(png, info, &profile_name, &compression, &profile_data, &profile_length) ==
            PNG_INFO_iCCP &&
        profile_data != nullptr && profile_length > 0) {
      icc.assign(profile_data, profile_data + profile_length);
    }

    // Normalise every variant to 16-bit RGBA: expand palettes and low-bit
    // greys, turn tRNS into a real alpha channel, promote 8-bit samples to 16
    // rather than the other way round, and add opaque alpha where there is
    // none. Keeping the depth is the point - an 8-bit strip here would throw
    // away exactly the precision the working space exists to preserve.
    if (color_type == PNG_COLOR_TYPE_PALETTE) png_set_palette_to_rgb(png);
    if (color_type == PNG_COLOR_TYPE_GRAY && source_bit_depth < 8) {
      png_set_expand_gray_1_2_4_to_8(png);
    }
    if (png_get_valid(png, info, PNG_INFO_tRNS) != 0) png_set_tRNS_to_alpha(png);
    if ((color_type & PNG_COLOR_MASK_COLOR) == 0) png_set_gray_to_rgb(png);
    png_set_expand_16(png);
    png_set_add_alpha(png, 0xFFFF, PNG_FILLER_AFTER);
    // PNG samples are big-endian; the working buffer is in host order.
    if (IsLittleEndian()) png_set_swap(png);
    if (png_get_interlace_type(png, info) != PNG_INTERLACE_NONE) {
      png_set_interlace_handling(png);
    }
    png_read_update_info(png, info);

    pixels = Image16::Create(static_cast<int>(width), static_cast<int>(height));
    std::vector<png_bytep> rows(height);
    for (png_uint_32 y = 0; y < height; ++y) {
      rows[y] = reinterpret_cast<png_bytep>(pixels.Row(static_cast<int>(y)));
    }
    png_read_image(png, rows.data());
    png_read_end(png, nullptr);
  }

  png_destroy_read_struct(&png, &info, nullptr);

  if (!failure.empty() || pixels.empty()) {
    throw EngineException(error_code::kDecodeFailed, "Could not decode PNG",
                          failure.empty() ? "libpng aborted" : failure);
  }

  DecodedImage decoded;
  decoded.pixels = std::move(pixels);
  decoded.icc = std::move(icc);
  decoded.bit_depth = source_bit_depth;
  decoded.has_alpha = has_alpha;
  decoded.orientation = Orientation::kTopLeft;  // PNG carries no capture orientation
  return decoded;
}

}  // namespace photoy
