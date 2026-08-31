#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "color/profile.h"
#include "decoder/decoder.h"
#include "decoder/exif.h"
#include "edit/layer.h"
#include "edit/render.h"
#include "image/image_buffer.h"
#include "jobs/cancellation.h"

namespace photoy {

/**
 * Pixels ready to be encoded, already converted out of the working space.
 *
 * A view rather than a buffer, and depth-agnostic, so that each encoder is
 * written once instead of once per sample size.
 */
struct OutputImage {
  int width = 0;
  int height = 0;
  /// 8 or 16. PNG and TIFF honour both; JPEG and WebP are 8-bit formats.
  int bit_depth = 8;
  const void* data = nullptr;
  /// Bytes per row.
  std::size_t stride = 0;

  static OutputImage From(const Image8& image) {
    return {image.width(), image.height(), 8, image.data(), image.stride()};
  }
  static OutputImage From(const Image16& image) {
    return {image.width(), image.height(), 16, image.data(), image.stride()};
  }
};

struct EncodeOptions {
  ImageFormat format = ImageFormat::kJpeg;
  /// 1-100. Honoured by JPEG and lossy WebP; PNG and TIFF are always lossless.
  int quality = 90;
  /// Colour space to convert into and tag the file with.
  color::OutputSpace space = color::OutputSpace::kSrgb;
  /**
   * Ask for 16-bit output. Only PNG and TIFF can honour it, and only when the
   * source had the depth to justify it - a 16-bit file made from an 8-bit JPEG
   * is twice the size and not one bit more information.
   */
  bool prefer_sixteen_bit = false;
  /// EXIF to embed, already normalised. Empty means write none.
  ExifBlob exif;
  /// ICC profile to embed, so the file says which space it is in.
  color::IccBytes icc;
  /// Composited on the way out, so an export matches what the preview showed.
  std::vector<Layer> layers;
  /// Raster masks the layers refer to, at full resolution.
  FittedMasks masks;
};

std::vector<std::uint8_t> EncodeJpeg(const OutputImage& image, const EncodeOptions& options);
std::vector<std::uint8_t> EncodePng(const OutputImage& image, const EncodeOptions& options);
std::vector<std::uint8_t> EncodeTiff(const OutputImage& image, const EncodeOptions& options);
std::vector<std::uint8_t> EncodeWebp(const OutputImage& image, const EncodeOptions& options);

/// Applies the adjustments, converts into the target space and depth, then
/// encodes. The conversion is the same one the preview uses, at full size.
std::vector<std::uint8_t> Encode(const Image16& working, const EncodeOptions& options,
                                 const CancellationTokenPtr& token = NeverCancelled());

/**
 * Encodes and publishes the result at `path`.
 *
 * The bytes land in a sibling temp file that is then moved into place, so a
 * failed or interrupted encode can never truncate a file the user already had.
 */
void EncodeToFile(const Image16& working, const EncodeOptions& options,
                  const std::string& utf8_path,
                  const CancellationTokenPtr& token = NeverCancelled());

}  // namespace photoy
