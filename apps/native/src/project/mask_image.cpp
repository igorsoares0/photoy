#ifdef _MSC_VER
// setjmp is the error-handling idiom libpng documents, and the guarded scopes
// below deliberately hold no objects with destructors.
#pragma warning(disable : 4611)
#endif

#include "project/mask_image.h"

#include <csetjmp>
#include <cstring>
#include <string>

#include <png.h>

#include "core/error.h"

namespace photoy {
namespace {

struct Reader {
  const std::uint8_t* data;
  std::size_t size;
  std::size_t offset;
};

void ReadFromMemory(png_structp png, png_bytep target, png_size_t length) {
  auto* reader = static_cast<Reader*>(png_get_io_ptr(png));
  if (reader->offset + length > reader->size) {
    png_error(png, "read past end of buffer");
    return;
  }
  std::memcpy(target, reader->data + reader->offset, length);
  reader->offset += length;
}

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

}  // namespace

std::vector<std::uint8_t> EncodeMaskPng(const MaskBuffer& mask) {
  if (mask.empty()) return {};

  std::string failure;
  png_structp png = png_create_write_struct(PNG_LIBPNG_VER_STRING, &failure, &OnError, &OnWarning);
  if (png == nullptr) {
    throw EngineException(error_code::kEncodeFailed, "Could not write the mask", "libpng");
  }
  png_infop info = png_create_info_struct(png);
  if (info == nullptr) {
    png_destroy_write_struct(&png, nullptr);
    throw EngineException(error_code::kEncodeFailed, "Could not write the mask", "libpng");
  }

  std::vector<std::uint8_t> bytes;
  bool wrote = false;
  if (setjmp(png_jmpbuf(png)) == 0) {
    png_set_write_fn(png, &bytes, &WriteToVector, &FlushVector);
    png_set_IHDR(png, info, static_cast<png_uint_32>(mask.width),
                 static_cast<png_uint_32>(mask.height), 8, PNG_COLOR_TYPE_GRAY,
                 PNG_INTERLACE_NONE, PNG_COMPRESSION_TYPE_DEFAULT, PNG_FILTER_TYPE_DEFAULT);
    png_write_info(png, info);
    for (int y = 0; y < mask.height; ++y) {
      png_write_row(png, const_cast<png_bytep>(
                             mask.coverage.data() + static_cast<std::size_t>(y) * mask.width));
    }
    png_write_end(png, nullptr);
    wrote = true;
  }
  png_destroy_write_struct(&png, &info);

  if (!wrote) {
    throw EngineException(error_code::kEncodeFailed, "Could not write the mask",
                          failure.empty() ? "libpng aborted" : failure);
  }
  return bytes;
}

MaskBuffer DecodeMaskPng(const std::vector<std::uint8_t>& bytes) {
  std::string failure;
  png_structp png = png_create_read_struct(PNG_LIBPNG_VER_STRING, &failure, &OnError, &OnWarning);
  if (png == nullptr) {
    throw EngineException(error_code::kFileUnreadable, "Could not read the mask", "libpng");
  }
  png_infop info = png_create_info_struct(png);
  if (info == nullptr) {
    png_destroy_read_struct(&png, nullptr, nullptr);
    throw EngineException(error_code::kFileUnreadable, "Could not read the mask", "libpng");
  }

  MaskBuffer mask;
  Reader reader{bytes.data(), bytes.size(), 0};
  if (setjmp(png_jmpbuf(png)) == 0) {
    png_set_read_fn(png, &reader, &ReadFromMemory);
    png_read_info(png, info);

    mask.width = static_cast<int>(png_get_image_width(png, info));
    mask.height = static_cast<int>(png_get_image_height(png, info));

    // Whatever it was written as, it is read as one 8-bit channel.
    const int colour = png_get_color_type(png, info);
    const int depth = png_get_bit_depth(png, info);
    if (colour == PNG_COLOR_TYPE_PALETTE) png_set_palette_to_rgb(png);
    if (colour == PNG_COLOR_TYPE_GRAY && depth < 8) png_set_expand_gray_1_2_4_to_8(png);
    if (depth == 16) png_set_strip_16(png);
    if ((colour & PNG_COLOR_MASK_COLOR) != 0) png_set_rgb_to_gray_fixed(png, 1, -1, -1);
    if ((colour & PNG_COLOR_MASK_ALPHA) != 0) png_set_strip_alpha(png);
    png_read_update_info(png, info);

    mask.coverage.assign(static_cast<std::size_t>(mask.width) * mask.height, 0);
    std::vector<png_bytep> rows(static_cast<std::size_t>(mask.height));
    for (int y = 0; y < mask.height; ++y) {
      rows[static_cast<std::size_t>(y)] =
          mask.coverage.data() + static_cast<std::size_t>(y) * mask.width;
    }
    png_read_image(png, rows.data());
    png_read_end(png, nullptr);
  }
  png_destroy_read_struct(&png, &info, nullptr);

  if (!failure.empty() || mask.empty()) {
    throw EngineException(error_code::kFileUnreadable, "Could not read the mask",
                          failure.empty() ? "libpng aborted" : failure);
  }
  return mask;
}

std::vector<std::uint8_t> EncodePatchPng(const Image8& pixels) {
  if (pixels.empty()) return {};

  std::string failure;
  png_structp png = png_create_write_struct(PNG_LIBPNG_VER_STRING, &failure, &OnError, &OnWarning);
  if (png == nullptr) {
    throw EngineException(error_code::kEncodeFailed, "Could not write the patch", "libpng");
  }
  png_infop info = png_create_info_struct(png);
  if (info == nullptr) {
    png_destroy_write_struct(&png, nullptr);
    throw EngineException(error_code::kEncodeFailed, "Could not write the patch", "libpng");
  }

  std::vector<std::uint8_t> bytes;
  bool wrote = false;
  if (setjmp(png_jmpbuf(png)) == 0) {
    png_set_write_fn(png, &bytes, &WriteToVector, &FlushVector);
    png_set_IHDR(png, info, static_cast<png_uint_32>(pixels.width()),
                 static_cast<png_uint_32>(pixels.height()), 8, PNG_COLOR_TYPE_RGB_ALPHA,
                 PNG_INTERLACE_NONE, PNG_COMPRESSION_TYPE_DEFAULT, PNG_FILTER_TYPE_DEFAULT);
    png_write_info(png, info);
    for (int y = 0; y < pixels.height(); ++y) {
      png_write_row(png, const_cast<png_bytep>(pixels.Row(y)));
    }
    png_write_end(png, nullptr);
    wrote = true;
  }
  png_destroy_write_struct(&png, &info);

  if (!wrote) {
    throw EngineException(error_code::kEncodeFailed, "Could not write the patch",
                          failure.empty() ? "libpng aborted" : failure);
  }
  return bytes;
}

Image8 DecodePatchPng(const std::vector<std::uint8_t>& bytes) {
  std::string failure;
  png_structp png = png_create_read_struct(PNG_LIBPNG_VER_STRING, &failure, &OnError, &OnWarning);
  if (png == nullptr) {
    throw EngineException(error_code::kFileUnreadable, "Could not read the patch", "libpng");
  }
  png_infop info = png_create_info_struct(png);
  if (info == nullptr) {
    png_destroy_read_struct(&png, nullptr, nullptr);
    throw EngineException(error_code::kFileUnreadable, "Could not read the patch", "libpng");
  }

  Image8 pixels;
  Reader reader{bytes.data(), bytes.size(), 0};
  if (setjmp(png_jmpbuf(png)) == 0) {
    png_set_read_fn(png, &reader, &ReadFromMemory);
    png_read_info(png, info);

    const int width = static_cast<int>(png_get_image_width(png, info));
    const int height = static_cast<int>(png_get_image_height(png, info));

    // Whatever it was written as, it is read as 8-bit RGBA.
    const int colour = png_get_color_type(png, info);
    const int depth = png_get_bit_depth(png, info);
    if (colour == PNG_COLOR_TYPE_PALETTE) png_set_palette_to_rgb(png);
    if (colour == PNG_COLOR_TYPE_GRAY && depth < 8) png_set_expand_gray_1_2_4_to_8(png);
    if (depth == 16) png_set_strip_16(png);
    if ((colour & PNG_COLOR_MASK_COLOR) == 0) png_set_gray_to_rgb(png);
    if ((colour & PNG_COLOR_MASK_ALPHA) == 0) png_set_add_alpha(png, 0xFF, PNG_FILLER_AFTER);
    png_read_update_info(png, info);

    pixels = Image8::Create(width, height);
    std::vector<png_bytep> rows(static_cast<std::size_t>(height));
    for (int y = 0; y < height; ++y) rows[static_cast<std::size_t>(y)] = pixels.Row(y);
    png_read_image(png, rows.data());
    png_read_end(png, nullptr);
  }
  png_destroy_read_struct(&png, &info, nullptr);

  if (!failure.empty() || pixels.empty()) {
    throw EngineException(error_code::kFileUnreadable, "Could not read the patch",
                          failure.empty() ? "libpng aborted" : failure);
  }
  return pixels;
}

}  // namespace photoy
