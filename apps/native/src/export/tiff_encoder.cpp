#include <algorithm>
#include <cstring>
#include <vector>

#include <tiffio.h>

#include "core/error.h"
#include "export/encoder.h"

namespace photoy {
namespace {

/// Growable sink backing libtiff's client IO while it writes the container.
struct MemorySink {
  std::vector<std::uint8_t> bytes;
  tmsize_t offset = 0;
};

tmsize_t SinkRead(thandle_t handle, void* target, tmsize_t length) {
  auto* sink = static_cast<MemorySink*>(handle);
  const tmsize_t available =
      std::max<tmsize_t>(0, static_cast<tmsize_t>(sink->bytes.size()) - sink->offset);
  const tmsize_t count = std::min(length, available);
  std::memcpy(target, sink->bytes.data() + sink->offset, static_cast<std::size_t>(count));
  sink->offset += count;
  return count;
}

tmsize_t SinkWrite(thandle_t handle, void* source, tmsize_t length) {
  auto* sink = static_cast<MemorySink*>(handle);
  const std::size_t end = static_cast<std::size_t>(sink->offset) + static_cast<std::size_t>(length);
  if (end > sink->bytes.size()) sink->bytes.resize(end);
  std::memcpy(sink->bytes.data() + sink->offset, source, static_cast<std::size_t>(length));
  sink->offset = static_cast<tmsize_t>(end);
  return length;
}

toff_t SinkSeek(thandle_t handle, toff_t offset, int whence) {
  auto* sink = static_cast<MemorySink*>(handle);
  tmsize_t base = 0;
  switch (whence) {
    case SEEK_SET: base = 0; break;
    case SEEK_CUR: base = sink->offset; break;
    case SEEK_END: base = static_cast<tmsize_t>(sink->bytes.size()); break;
    default: return static_cast<toff_t>(-1);
  }
  const tmsize_t target = base + static_cast<tmsize_t>(offset);
  if (target < 0) return static_cast<toff_t>(-1);
  sink->offset = target;
  return static_cast<toff_t>(sink->offset);
}

int SinkClose(thandle_t) { return 0; }
toff_t SinkSize(thandle_t handle) {
  return static_cast<toff_t>(static_cast<MemorySink*>(handle)->bytes.size());
}
int SinkMap(thandle_t, void**, toff_t*) { return 0; }
void SinkUnmap(thandle_t, void*, toff_t) {}

void SilenceHandler(const char*, const char*, va_list) {}

}  // namespace

std::vector<std::uint8_t> EncodeTiff(const OutputImage& image, const EncodeOptions& options) {
  TIFFSetErrorHandler(&SilenceHandler);
  TIFFSetWarningHandler(&SilenceHandler);

  MemorySink sink;
  TIFF* tiff = TIFFClientOpen("photoy", "w", &sink, &SinkRead, &SinkWrite, &SinkSeek,
                              &SinkClose, &SinkSize, &SinkMap, &SinkUnmap);
  if (tiff == nullptr) {
    throw EngineException(error_code::kEncodeFailed, "Could not encode TIFF",
                          "TIFFClientOpen failed");
  }

  TIFFSetField(tiff, TIFFTAG_IMAGEWIDTH, static_cast<std::uint32_t>(image.width));
  TIFFSetField(tiff, TIFFTAG_IMAGELENGTH, static_cast<std::uint32_t>(image.height));
  TIFFSetField(tiff, TIFFTAG_SAMPLESPERPIXEL, static_cast<std::uint16_t>(kChannels));
  TIFFSetField(tiff, TIFFTAG_BITSPERSAMPLE, static_cast<std::uint16_t>(image.bit_depth));
  TIFFSetField(tiff, TIFFTAG_SAMPLEFORMAT, static_cast<std::uint16_t>(SAMPLEFORMAT_UINT));
  TIFFSetField(tiff, TIFFTAG_ORIENTATION, ORIENTATION_TOPLEFT);
  TIFFSetField(tiff, TIFFTAG_PLANARCONFIG, PLANARCONFIG_CONTIG);
  TIFFSetField(tiff, TIFFTAG_PHOTOMETRIC, PHOTOMETRIC_RGB);
  TIFFSetField(tiff, TIFFTAG_COMPRESSION, COMPRESSION_DEFLATE);
  TIFFSetField(tiff, TIFFTAG_ROWSPERSTRIP, TIFFDefaultStripSize(tiff, 0));

  // Alpha here is unassociated: colour channels are not premultiplied, which is
  // what every decoder in this engine also assumes.
  const std::uint16_t extra_samples[] = {EXTRASAMPLE_UNASSALPHA};
  TIFFSetField(tiff, TIFFTAG_EXTRASAMPLES, static_cast<std::uint16_t>(1), extra_samples);

  if (!options.icc.empty()) {
    TIFFSetField(tiff, TIFFTAG_ICCPROFILE, static_cast<std::uint32_t>(options.icc.size()),
                 options.icc.data());
  }

  const auto* base = static_cast<const std::uint8_t*>(image.data);
  bool ok = true;
  for (int y = 0; y < image.height && ok; ++y) {
    ok = TIFFWriteScanline(tiff,
                           const_cast<std::uint8_t*>(base + static_cast<std::size_t>(y) * image.stride),
                           static_cast<std::uint32_t>(y), 0) >= 0;
  }
  TIFFClose(tiff);

  if (!ok) {
    throw EngineException(error_code::kEncodeFailed, "Could not encode TIFF",
                          "TIFFWriteScanline failed");
  }
  return std::move(sink.bytes);
}

}  // namespace photoy
