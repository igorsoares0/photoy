#include <algorithm>
#include <cstring>
#include <string>
#include <vector>

#include <tiffio.h>

#include "core/error.h"
#include "decoder/decoder.h"

namespace photoy {
namespace {

/// Cursor over the in-memory file, driving libtiff's client IO callbacks.
struct MemoryStream {
  const std::uint8_t* data;
  tmsize_t size;
  tmsize_t offset;
};

tmsize_t StreamRead(thandle_t handle, void* target, tmsize_t length) {
  auto* stream = static_cast<MemoryStream*>(handle);
  const tmsize_t available = std::max<tmsize_t>(0, stream->size - stream->offset);
  const tmsize_t count = std::min(length, available);
  std::memcpy(target, stream->data + stream->offset, static_cast<std::size_t>(count));
  stream->offset += count;
  return count;
}

tmsize_t StreamWrite(thandle_t, void*, tmsize_t) { return 0; }  // decode only

toff_t StreamSeek(thandle_t handle, toff_t offset, int whence) {
  auto* stream = static_cast<MemoryStream*>(handle);
  tmsize_t base = 0;
  switch (whence) {
    case SEEK_SET: base = 0; break;
    case SEEK_CUR: base = stream->offset; break;
    case SEEK_END: base = stream->size; break;
    default: return static_cast<toff_t>(-1);
  }
  const tmsize_t target = base + static_cast<tmsize_t>(offset);
  if (target < 0) return static_cast<toff_t>(-1);
  stream->offset = target;
  return static_cast<toff_t>(stream->offset);
}

int StreamClose(thandle_t) { return 0; }
toff_t StreamSize(thandle_t handle) {
  return static_cast<toff_t>(static_cast<MemoryStream*>(handle)->size);
}
int StreamMap(thandle_t, void**, toff_t*) { return 0; }
void StreamUnmap(thandle_t, void*, toff_t) {}

void SilenceHandler(const char*, const char*, va_list) {}

color::IccBytes ReadIccTag(TIFF* tiff) {
  std::uint32_t length = 0;
  void* data = nullptr;
  if (TIFFGetField(tiff, TIFFTAG_ICCPROFILE, &length, &data) != 1 || data == nullptr ||
      length == 0) {
    return {};
  }
  const auto* bytes = static_cast<const std::uint8_t*>(data);
  return color::IccBytes(bytes, bytes + length);
}

/**
 * Whether the file is a plain 16-bit RGB image we can read scanline by scanline.
 *
 * libtiff's RGBA interface handles every exotic layout for us but only ever
 * hands back 8 bits, so the common case - a 16-bit RGB TIFF out of a scanner or
 * an editor - gets a direct path that keeps its depth. Anything stranger falls
 * back, correct but at 8 bits.
 */
bool CanReadAsSixteenBit(TIFF* tiff, std::uint16_t bits, std::uint16_t samples) {
  if (bits != 16 || (samples != 3 && samples != 4)) return false;
  if (TIFFIsTiled(tiff) != 0) return false;

  std::uint16_t photometric = 0;
  std::uint16_t planar = 0;
  std::uint16_t sample_format = SAMPLEFORMAT_UINT;
  TIFFGetFieldDefaulted(tiff, TIFFTAG_PHOTOMETRIC, &photometric);
  TIFFGetFieldDefaulted(tiff, TIFFTAG_PLANARCONFIG, &planar);
  TIFFGetFieldDefaulted(tiff, TIFFTAG_SAMPLEFORMAT, &sample_format);

  return photometric == PHOTOMETRIC_RGB && planar == PLANARCONFIG_CONTIG &&
         sample_format == SAMPLEFORMAT_UINT;
}

/// Reads a 16-bit contiguous RGB or RGBA image into the working buffer.
bool ReadSixteenBitScanlines(TIFF* tiff, std::uint32_t width, std::uint32_t height,
                             std::uint16_t samples, Image16& target) {
  const tmsize_t scanline_size = TIFFScanlineSize(tiff);
  if (scanline_size <= 0 ||
      static_cast<std::size_t>(scanline_size) < static_cast<std::size_t>(width) * samples * 2) {
    return false;
  }

  std::vector<std::uint16_t> row(static_cast<std::size_t>(scanline_size) / 2 + samples);
  for (std::uint32_t y = 0; y < height; ++y) {
    if (TIFFReadScanline(tiff, row.data(), y, 0) < 0) return false;
    std::uint16_t* out = target.Row(static_cast<int>(y));
    for (std::uint32_t x = 0; x < width; ++x) {
      const std::uint16_t* pixel = row.data() + static_cast<std::size_t>(x) * samples;
      std::uint16_t* target_pixel = out + static_cast<std::size_t>(x) * kChannels;
      target_pixel[0] = pixel[0];
      target_pixel[1] = pixel[1];
      target_pixel[2] = pixel[2];
      target_pixel[3] = samples == 4 ? pixel[3] : Image16::kMaxValue;
    }
  }
  return true;
}

}  // namespace

DecodedImage DecodeTiff(const std::vector<std::uint8_t>& bytes) {
  // libtiff prints to stderr by default; route diagnostics into our exception
  // instead so a partially broken file produces one clean error.
  TIFFSetErrorHandler(&SilenceHandler);
  TIFFSetWarningHandler(&SilenceHandler);

  MemoryStream stream {bytes.data(), static_cast<tmsize_t>(bytes.size()), 0};
  TIFF* tiff = TIFFClientOpen("photoy", "r", &stream, &StreamRead, &StreamWrite, &StreamSeek,
                              &StreamClose, &StreamSize, &StreamMap, &StreamUnmap);
  if (tiff == nullptr) {
    throw EngineException(error_code::kDecodeFailed, "Could not decode TIFF",
                          "TIFFClientOpen failed");
  }

  std::uint32_t width = 0;
  std::uint32_t height = 0;
  std::uint16_t bits_per_sample = 8;
  std::uint16_t samples_per_pixel = 3;
  TIFFGetField(tiff, TIFFTAG_IMAGEWIDTH, &width);
  TIFFGetField(tiff, TIFFTAG_IMAGELENGTH, &height);
  TIFFGetFieldDefaulted(tiff, TIFFTAG_BITSPERSAMPLE, &bits_per_sample);
  TIFFGetFieldDefaulted(tiff, TIFFTAG_SAMPLESPERPIXEL, &samples_per_pixel);

  if (width == 0 || height == 0) {
    TIFFClose(tiff);
    throw EngineException(error_code::kDecodeFailed, "Could not decode TIFF",
                          "image has no dimensions");
  }

  Image16 pixels;
  color::IccBytes icc;
  bool kept_sixteen_bit = false;
  try {
    pixels = Image16::Create(static_cast<int>(width), static_cast<int>(height));
    icc = ReadIccTag(tiff);

    if (CanReadAsSixteenBit(tiff, bits_per_sample, samples_per_pixel)) {
      kept_sixteen_bit =
          ReadSixteenBitScanlines(tiff, width, height, samples_per_pixel, pixels);
    }

    if (!kept_sixteen_bit) {
      // The RGBA interface normalises stripes, tiles, colour spaces and bit
      // depths in one call, and honours the file's own orientation tag for us.
      std::vector<std::uint32_t> raster(static_cast<std::size_t>(width) * height);
      if (TIFFReadRGBAImageOriented(tiff, width, height, raster.data(), ORIENTATION_TOPLEFT, 0) ==
          0) {
        throw EngineException(error_code::kDecodeFailed, "Could not decode TIFF",
                              "TIFFReadRGBAImageOriented failed");
      }
      for (std::uint32_t y = 0; y < height; ++y) {
        const std::uint32_t* source = raster.data() + static_cast<std::size_t>(y) * width;
        std::uint16_t* target = pixels.Row(static_cast<int>(y));
        for (std::uint32_t x = 0; x < width; ++x) {
          const std::uint32_t value = source[x];
          std::uint16_t* out = target + static_cast<std::size_t>(x) * kChannels;
          out[0] = Widen8To16(static_cast<std::uint8_t>(TIFFGetR(value)));
          out[1] = Widen8To16(static_cast<std::uint8_t>(TIFFGetG(value)));
          out[2] = Widen8To16(static_cast<std::uint8_t>(TIFFGetB(value)));
          out[3] = Widen8To16(static_cast<std::uint8_t>(TIFFGetA(value)));
        }
      }
    }
  } catch (...) {
    TIFFClose(tiff);
    throw;
  }
  TIFFClose(tiff);

  DecodedImage decoded;
  decoded.pixels = std::move(pixels);
  decoded.icc = std::move(icc);
  decoded.bit_depth = kept_sixteen_bit ? 16 : 8;
  decoded.has_alpha = samples_per_pixel > 3;
  decoded.orientation = Orientation::kTopLeft;  // already resolved by libtiff
  return decoded;
}

}  // namespace photoy
