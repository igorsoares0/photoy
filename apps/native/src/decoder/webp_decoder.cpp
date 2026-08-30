#include <cstring>
#include <string>
#include <vector>

#include <webp/decode.h>
#include <webp/demux.h>

#include "core/error.h"
#include "decoder/decoder.h"
#include "decoder/exif.h"

namespace photoy {
namespace {

/// Pulls the EXIF chunk out of an extended WebP container, if there is one.
ExifBlob ExtractWebpExif(const std::vector<std::uint8_t>& bytes) {
  WebPData source {bytes.data(), bytes.size()};
  WebPDemuxer* demuxer = WebPDemux(&source);
  if (demuxer == nullptr) return {};

  ExifBlob exif;
  const std::uint32_t flags = WebPDemuxGetI(demuxer, WEBP_FF_FORMAT_FLAGS);
  if ((flags & EXIF_FLAG) != 0) {
    WebPChunkIterator chunk;
    if (WebPDemuxGetChunk(demuxer, "EXIF", 1, &chunk) != 0) {
      exif.assign(chunk.chunk.bytes, chunk.chunk.bytes + chunk.chunk.size);
      WebPDemuxReleaseChunkIterator(&chunk);
    }
  }
  WebPDemuxDelete(demuxer);
  return exif;
}

/// Pulls the ICC chunk out of an extended WebP container, if there is one.
color::IccBytes ExtractWebpIcc(const std::vector<std::uint8_t>& bytes) {
  WebPData source {bytes.data(), bytes.size()};
  WebPDemuxer* demuxer = WebPDemux(&source);
  if (demuxer == nullptr) return {};

  color::IccBytes icc;
  if ((WebPDemuxGetI(demuxer, WEBP_FF_FORMAT_FLAGS) & ICCP_FLAG) != 0) {
    WebPChunkIterator chunk;
    if (WebPDemuxGetChunk(demuxer, "ICCP", 1, &chunk) != 0) {
      icc.assign(chunk.chunk.bytes, chunk.chunk.bytes + chunk.chunk.size);
      WebPDemuxReleaseChunkIterator(&chunk);
    }
  }
  WebPDemuxDelete(demuxer);
  return icc;
}

}  // namespace

DecodedImage DecodeWebp(const std::vector<std::uint8_t>& bytes) {
  WebPBitstreamFeatures features {};
  if (WebPGetFeatures(bytes.data(), bytes.size(), &features) != VP8_STATUS_OK) {
    throw EngineException(error_code::kDecodeFailed, "Could not decode WebP",
                          "WebPGetFeatures rejected the bitstream");
  }
  if (features.has_animation != 0) {
    throw EngineException(error_code::kUnsupportedFormat, "Animated WebP is not supported",
                          "animation flag set");
  }

  Image8 pixels = Image8::Create(features.width, features.height);
  const std::size_t buffer_size = pixels.size_bytes();
  if (WebPDecodeRGBAInto(bytes.data(), bytes.size(), pixels.data(),
                         buffer_size, static_cast<int>(pixels.stride())) == nullptr) {
    throw EngineException(error_code::kDecodeFailed, "Could not decode WebP",
                          "WebPDecodeRGBAInto failed");
  }

  DecodedImage decoded;
  decoded.bit_depth = 8;  // WebP is an 8-bit format
  decoded.has_alpha = features.has_alpha != 0;
  decoded.icc = ExtractWebpIcc(bytes);
  decoded.orientation = ReadOrientation(ExtractWebpExif(bytes));
  decoded.pixels = ApplyOrientation(Widen(pixels), decoded.orientation);
  return decoded;
}

}  // namespace photoy
