#include "export/encoder.h"

#include <cstdio>

#include "color/pipeline.h"
#include "core/error.h"
#include "core/paths.h"
#include "edit/render.h"

namespace photoy {
namespace {

/// JPEG has no alpha channel. Writing one and letting the encoder drop it would
/// silently bring a removed background back, so the image is composited onto
/// white first.
bool FormatCarriesAlpha(ImageFormat format) noexcept { return format != ImageFormat::kJpeg; }

/// Only PNG and TIFF can carry more than 8 bits per channel.
bool FormatSupportsSixteenBit(ImageFormat format) noexcept {
  return format == ImageFormat::kPng || format == ImageFormat::kTiff;
}

std::vector<std::uint8_t> EncodeFormat(const OutputImage& image, const EncodeOptions& options) {
  switch (options.format) {
    case ImageFormat::kJpeg: return EncodeJpeg(image, options);
    case ImageFormat::kPng: return EncodePng(image, options);
    case ImageFormat::kTiff: return EncodeTiff(image, options);
    case ImageFormat::kWebp: return EncodeWebp(image, options);
    case ImageFormat::kUnknown: break;
  }
  throw EngineException(error_code::kUnsupportedFormat, "Unsupported export format",
                        "no encoder for the requested format");
}

}  // namespace

std::vector<std::uint8_t> Encode(const Image16& working, const EncodeOptions& options,
                                 const CancellationTokenPtr& token) {
  if (working.empty()) {
    throw EngineException(error_code::kEncodeFailed, "Nothing to encode", "empty image buffer");
  }

  // The colour conversion happens here rather than inside each encoder, so
  // there is exactly one place where working-space pixels become file pixels.
  if (options.prefer_sixteen_bit && FormatSupportsSixteenBit(options.format)) {
    const Image16 output = ComposeToOutput16(working, options.layers, options.masks,
                                             options.space, token,
                                             !FormatCarriesAlpha(options.format));
    return EncodeFormat(OutputImage::From(output), options);
  }
  const Image8 output = ComposeToOutput8(working, options.layers, options.masks, options.space,
                                         token, !FormatCarriesAlpha(options.format));
  return EncodeFormat(OutputImage::From(output), options);
}

void EncodeToFile(const Image16& working, const EncodeOptions& options,
                  const std::string& utf8_path, const CancellationTokenPtr& token) {
  const std::vector<std::uint8_t> bytes = Encode(working, options, token);

  const std::string temp_path = utf8_path + ".photoy-tmp";
  {
    paths::FileHandle file = paths::OpenWrite(temp_path);
    if (file == nullptr) {
      throw EngineException(error_code::kWriteFailed, "Could not create the export file",
                            temp_path);
    }
    const std::size_t written = std::fwrite(bytes.data(), 1, bytes.size(), file.get());
    const bool flushed = std::fflush(file.get()) == 0;
    if (written != bytes.size() || !flushed) {
      file.reset();
      paths::RemoveFile(temp_path);
      throw EngineException(error_code::kWriteFailed, "Could not write the export file",
                            "wrote " + std::to_string(written) + " of " +
                                std::to_string(bytes.size()) + " bytes");
    }
  }

  try {
    paths::MoveReplacing(temp_path, utf8_path);
  } catch (...) {
    paths::RemoveFile(temp_path);
    throw;
  }
}

}  // namespace photoy
