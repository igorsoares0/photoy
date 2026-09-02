#include "engine/thumbnail.h"

#include <algorithm>

#include "color/pipeline.h"
#include "color/profile.h"
#include "core/error.h"
#include "core/paths.h"
#include "decoder/format_sniffer.h"
#include "export/encoder.h"
#include "image/orientation.h"
#include "image/resample.h"

namespace photoy {
namespace {

/**
 * Quality of the stored thumbnail.
 *
 * Lower than an export's, and deliberately: this is a picture the size of a
 * postage stamp shown next to two hundred others, where the difference between
 * 82 and 92 is invisible and the difference in what a folder costs on disk is
 * not.
 */
constexpr int kThumbnailQuality = 82;

/// Below this the camera's preview is not worth having: it would be enlarged.
constexpr int kMinimumEmbeddedSide = 160;

/**
 * The camera's own preview, decoded and turned the right way up.
 *
 * Returns an empty image when there is no usable one, which is the signal to
 * decode the file the long way.
 */
Image16 EmbeddedPreview(const std::vector<std::uint8_t>& bytes, int max_side,
                        RawPreviewInfo* out_info) {
  const std::vector<std::uint8_t> preview = RawPreview(bytes, out_info);
  if (preview.empty()) return {};

  DecodedImage decoded = DecodeJpeg(preview);
  if (decoded.pixels.width() < max_side && decoded.pixels.height() < max_side &&
      std::max(decoded.pixels.width(), decoded.pixels.height()) < kMinimumEmbeddedSide) {
    return {};
  }
  /*
   * Whose rotation to believe.
   *
   * A preview that carries its own EXIF orientation has already been turned
   * upright by the decode, and the camera's flip describes the same rotation a
   * second time: applying both leaves an iPhone DNG lying on its side, which is
   * what this did until it was looked at. So the flip is only owed by a preview
   * that said nothing about itself.
   */
  const Orientation owed = decoded.orientation == Orientation::kTopLeft
                               ? out_info->orientation
                               : Orientation::kTopLeft;
  return ApplyOrientation(decoded.pixels, owed, NeverCancelled());
}

}  // namespace

Thumbnail MakeThumbnail(const std::string& utf8_path, int max_side,
                        const CancellationTokenPtr& token) {
  const int side = std::clamp(max_side, 32, kMaxThumbnailSide);
  const std::vector<std::uint8_t> bytes = paths::ReadAll(utf8_path);

  ImageFormat format = SniffFormat(bytes);
  if (format == ImageFormat::kTiff || format == ImageFormat::kUnknown) {
    if (IsRaw(bytes)) format = ImageFormat::kRaw;
  }

  Thumbnail thumbnail;
  thumbnail.format = format;

  Image16 source;
  RawPreviewInfo preview;
  if (format == ImageFormat::kRaw) {
    source = EmbeddedPreview(bytes, side, &preview);
    thumbnail.embedded = source.width() > 0;
  }

  color::Profile profile = color::Profile::Srgb();
  if (source.width() == 0) {
    // No preview to lean on, so the file is decoded the way opening it would -
    // which for a raw frame is seconds rather than milliseconds, and is why the
    // preview is tried first.
    DecodedImage decoded = Decode(bytes, &format, {});
    thumbnail.format = format;
    profile = decoded.in_working_space ? color::Profile::Working()
                                       : color::Profile::FromIcc(decoded.icc);
    source = std::move(decoded.pixels);
  }
  if (token->cancelled()) {
    throw EngineException(error_code::kCancelled, "Thumbnail cancelled", "superseded");
  }

  // The photograph's size, which for an embedded preview is not the preview's:
  // a camera stores a two megapixel JPEG inside a twenty-four megapixel frame,
  // and reporting the preview's size would make every raw file in the folder
  // claim to be small.
  thumbnail.source_width = thumbnail.embedded ? preview.width : source.width();
  thumbnail.source_height = thumbnail.embedded ? preview.height : source.height();

  // Reduced before the colour conversion, not after: converting a 24 megapixel
  // frame to sRGB so that a 256 pixel one can be cut out of it is most of the
  // work of opening the photograph, for a picture the size of a stamp.
  const FitResult fit = FitInside(source.width(), source.height(), side, side);
  const Image16 reduced =
      fit.scale < 1.0
          ? DownscaleBox(source, Rect{0, 0, source.width(), source.height()}, fit.width, fit.height,
                         token)
          : Image16{};
  const Image16& small = fit.scale < 1.0 ? reduced : source;

  const Image16 working = color::ToWorking(small, profile);
  const Image8 output = color::ToOutput8(working, color::OutputSpace::kSrgb, token);

  EncodeOptions options;
  options.format = ImageFormat::kJpeg;
  options.quality = kThumbnailQuality;
  options.space = color::OutputSpace::kSrgb;
  thumbnail.jpeg = EncodeJpeg(OutputImage::From(output), options);
  thumbnail.width = output.width();
  thumbnail.height = output.height();
  return thumbnail;
}

}  // namespace photoy
