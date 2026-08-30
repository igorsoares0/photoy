#include <cstdlib>
#include <vector>

#include <webp/encode.h>
#include <webp/mux.h>

#include "core/error.h"
#include "export/encoder.h"

namespace photoy {
namespace {

/**
 * Wraps encoded WebP bytes in an extended container so metadata can ride along.
 *
 * The plain encoder emits a simple stream with nowhere to put a profile, so
 * anything tagged has to be reassembled through the mux API. Returns the input
 * unchanged when there is nothing to attach.
 */
std::vector<std::uint8_t> AttachMetadata(const std::vector<std::uint8_t>& encoded,
                                         const EncodeOptions& options) {
  if (options.icc.empty() && options.exif.empty()) return encoded;

  WebPMux* mux = WebPMuxNew();
  if (mux == nullptr) return encoded;

  std::vector<std::uint8_t> result = encoded;
  const WebPData image {encoded.data(), encoded.size()};

  if (WebPMuxSetImage(mux, &image, 1) == WEBP_MUX_OK) {
    if (!options.icc.empty()) {
      const WebPData icc {options.icc.data(), options.icc.size()};
      WebPMuxSetChunk(mux, "ICCP", &icc, 1);
    }
    if (!options.exif.empty()) {
      const WebPData exif {options.exif.data(), options.exif.size()};
      WebPMuxSetChunk(mux, "EXIF", &exif, 1);
    }

    WebPData assembled {nullptr, 0};
    if (WebPMuxAssemble(mux, &assembled) == WEBP_MUX_OK && assembled.bytes != nullptr) {
      result.assign(assembled.bytes, assembled.bytes + assembled.size);
      WebPDataClear(&assembled);
    }
  }

  WebPMuxDelete(mux);
  return result;
}

}  // namespace

std::vector<std::uint8_t> EncodeWebp(const OutputImage& image, const EncodeOptions& options) {
  if (image.bit_depth != 8) {
    throw EngineException(error_code::kEncodeFailed, "WebP requires 8-bit samples",
                          std::to_string(image.bit_depth) + " bits requested");
  }

  const auto* pixels = static_cast<const std::uint8_t*>(image.data);
  std::uint8_t* output = nullptr;
  // Quality 100 is treated as a request for lossless, which is what a user
  // dragging the slider to the top is actually asking for.
  const std::size_t size =
      options.quality >= 100
          ? WebPEncodeLosslessRGBA(pixels, image.width, image.height,
                                   static_cast<int>(image.stride), &output)
          : WebPEncodeRGBA(pixels, image.width, image.height, static_cast<int>(image.stride),
                           static_cast<float>(options.quality), &output);

  if (size == 0 || output == nullptr) {
    if (output != nullptr) WebPFree(output);
    throw EngineException(error_code::kEncodeFailed, "Could not encode WebP",
                          "libwebp returned no data");
  }

  const std::vector<std::uint8_t> encoded(output, output + size);
  WebPFree(output);
  return AttachMetadata(encoded, options);
}

}  // namespace photoy
