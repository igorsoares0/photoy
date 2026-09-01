#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif

#ifdef _WIN32
#include <windows.h>
#include <wincodec.h>
#include <wrl/client.h>

#include <algorithm>
#include <cstring>
#include <string>
#include <vector>

#include "core/error.h"
#include "decoder/decoder.h"

namespace photoy {
namespace {

using Microsoft::WRL::ComPtr;

/**
 * The one error message here anybody will ever read.
 *
 * A HEIC that will not open is almost never a broken file - it is a machine
 * without the codec. Saying "unsupported format" would send somebody looking
 * for a fault in their photograph, so this says what to do instead.
 */
[[noreturn]] void NoCodec() {
  throw EngineException(error_code::kUnsupportedFormat, "HEIC needs the Windows extension",
                        "install the free HEIF Image Extensions from the Microsoft Store, then "
                        "open the photograph again");
}

/// COM is initialised per thread, and the job queue has several. Doing it here
/// keeps the decoder callable from any of them without the engine arranging it.
class ComScope {
 public:
  ComScope() : initialised_(SUCCEEDED(CoInitializeEx(nullptr, COINIT_MULTITHREADED))) {}
  ~ComScope() {
    if (initialised_) CoUninitialize();
  }
  ComScope(const ComScope&) = delete;
  ComScope& operator=(const ComScope&) = delete;

 private:
  bool initialised_ = false;
};

/**
 * The orientation still to be applied, which is usually none.
 *
 * HEIF declares rotation in the container - the `irot` and `imir` boxes - and
 * separately in whatever EXIF it carries. Measured on a photograph from an
 * iPhone 12 Pro: the file holds `irot` with three quarter turns, no EXIF
 * orientation tag at all, and Windows' codec hands back a frame that is already
 * upright and reports the property as 1. So on this platform the work is done
 * before we are asked.
 *
 * The container's own is still read first, and read for a value greater than
 * one, so that a codec which reports the rotation instead of performing it gets
 * honoured rather than ignored. That is not idle: this decoder is the seam a
 * macOS port replaces, and nothing says the codec there behaves the same.
 */
Orientation ReadOrientation(IWICBitmapFrameDecode* frame) {
  ComPtr<IWICMetadataQueryReader> reader;
  if (FAILED(frame->GetMetadataQueryReader(&reader)) || reader == nullptr) {
    return Orientation::kTopLeft;
  }
  for (const wchar_t* path : {L"/heifProps/Orientation", L"/ifd/{ushort=274}",
                              L"/app1/ifd/{ushort=274}"}) {
    PROPVARIANT value;
    PropVariantInit(&value);
    const bool found = SUCCEEDED(reader->GetMetadataByName(path, &value)) &&
                       (value.vt == VT_UI2 || value.vt == VT_UI4);
    const int declared = value.vt == VT_UI2 ? value.uiVal : static_cast<int>(value.ulVal);
    PropVariantClear(&value);
    // One means upright, and so does a source that says nothing. Skipping it
    // lets the next source be asked rather than settling for the default.
    if (found && declared > 1) return OrientationFromInt(declared);
  }
  return Orientation::kTopLeft;
}

/// The embedded profile, empty when the file carries none.
color::IccBytes ReadIcc(IWICBitmapFrameDecode* frame) {
  ComPtr<IWICColorContext> context;
  ComPtr<IWICImagingFactory> factory;
  if (FAILED(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER,
                              IID_PPV_ARGS(&factory)))) {
    return {};
  }
  if (FAILED(factory->CreateColorContext(&context))) return {};

  IWICColorContext* contexts[1] = {context.Get()};
  UINT count = 0;
  if (FAILED(frame->GetColorContexts(1, contexts, &count)) || count == 0) return {};

  WICColorContextType type = WICColorContextUninitialized;
  if (FAILED(context->GetType(&type)) || type != WICColorContextProfile) return {};

  UINT bytes = 0;
  if (FAILED(context->GetProfileBytes(0, nullptr, &bytes)) || bytes == 0) return {};
  color::IccBytes icc(bytes);
  if (FAILED(context->GetProfileBytes(bytes, icc.data(), &bytes))) return {};
  icc.resize(bytes);
  return icc;
}

}  // namespace

DecodedImage DecodeHeif(const std::vector<std::uint8_t>& bytes) {
  const ComScope com;

  ComPtr<IWICImagingFactory> factory;
  if (FAILED(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER,
                              IID_PPV_ARGS(&factory)))) {
    throw EngineException(error_code::kInternalError, "Could not decode HEIC",
                          "the imaging component would not start");
  }

  // Initialised from the bytes we already hold rather than from the path: the
  // engine may be decoding something that came out of a project container and
  // never had a path of its own.
  ComPtr<IWICStream> stream;
  if (FAILED(factory->CreateStream(&stream)) ||
      FAILED(stream->InitializeFromMemory(const_cast<BYTE*>(bytes.data()),
                                          static_cast<DWORD>(bytes.size())))) {
    throw EngineException(error_code::kInternalError, "Could not decode HEIC",
                          "could not wrap the file in a stream");
  }

  ComPtr<IWICBitmapDecoder> decoder;
  const HRESULT opened = factory->CreateDecoderFromStream(
      stream.Get(), nullptr, WICDecodeMetadataCacheOnDemand, &decoder);
  if (FAILED(opened)) {
    // WIC reports a missing codec the same way it reports a corrupt file, and
    // the sniffer already said this is a HEIF container, so a missing codec is
    // overwhelmingly the likelier of the two.
    if (opened == WINCODEC_ERR_COMPONENTNOTFOUND) NoCodec();
    throw EngineException(error_code::kDecodeFailed, "Could not decode HEIC",
                          "the codec refused the file");
  }

  ComPtr<IWICBitmapFrameDecode> frame;
  if (FAILED(decoder->GetFrame(0, &frame))) {
    throw EngineException(error_code::kDecodeFailed, "Could not decode HEIC", "no image inside");
  }

  UINT width = 0;
  UINT height = 0;
  if (FAILED(frame->GetSize(&width, &height)) || width == 0 || height == 0) {
    throw EngineException(error_code::kDecodeFailed, "Could not decode HEIC",
                          "the image has no dimensions");
  }

  WICPixelFormatGUID source_format{};
  frame->GetPixelFormat(&source_format);

  // Ten-bit HEIC is what a phone writes for a photograph taken in HDR, and
  // converting that to eight bits on the way in would throw away the range
  // before any adjustment could use it.
  UINT source_bits = 8;
  {
    ComPtr<IWICComponentInfo> info;
    ComPtr<IWICPixelFormatInfo> pixel_info;
    if (SUCCEEDED(factory->CreateComponentInfo(source_format, &info)) &&
        SUCCEEDED(info.As(&pixel_info))) {
      UINT channels = 0;
      UINT bits = 0;
      if (SUCCEEDED(pixel_info->GetChannelCount(&channels)) && channels > 0 &&
          SUCCEEDED(pixel_info->GetBitsPerPixel(&bits))) {
        source_bits = bits / channels;
      }
    }
  }
  const bool deep = source_bits > 8;

  ComPtr<IWICFormatConverter> converter;
  if (FAILED(factory->CreateFormatConverter(&converter)) ||
      FAILED(converter->Initialize(frame.Get(),
                                   deep ? GUID_WICPixelFormat64bppRGBA
                                        : GUID_WICPixelFormat32bppRGBA,
                                   WICBitmapDitherTypeNone, nullptr, 0.0,
                                   WICBitmapPaletteTypeCustom))) {
    throw EngineException(error_code::kDecodeFailed, "Could not decode HEIC",
                          "the pixels are in a layout we cannot read");
  }

  Image16 pixels = Image16::Create(static_cast<int>(width), static_cast<int>(height));
  const UINT sample_size = deep ? 2 : 1;
  const UINT stride = width * kChannels * sample_size;
  std::vector<std::uint8_t> raw(static_cast<std::size_t>(stride) * height);
  if (FAILED(converter->CopyPixels(nullptr, stride, static_cast<UINT>(raw.size()), raw.data()))) {
    throw EngineException(error_code::kDecodeFailed, "Could not decode HEIC",
                          "the codec stopped part way through");
  }

  for (UINT y = 0; y < height; ++y) {
    std::uint16_t* target = pixels.Row(static_cast<int>(y));
    if (deep) {
      const auto* source =
          reinterpret_cast<const std::uint16_t*>(raw.data() + static_cast<std::size_t>(y) * stride);
      std::memcpy(target, source, static_cast<std::size_t>(width) * kChannels * sizeof(std::uint16_t));
    } else {
      const std::uint8_t* source = raw.data() + static_cast<std::size_t>(y) * stride;
      for (UINT x = 0; x < width * kChannels; ++x) target[x] = Widen8To16(source[x]);
    }
  }

  DecodedImage decoded;
  decoded.icc = ReadIcc(frame.Get());
  decoded.bit_depth = deep ? 16 : 8;
  // A photograph has no transparency; a HEIF can carry an alpha auxiliary
  // image, and the converter has already composited or filled it for us.
  decoded.has_alpha = false;
  decoded.orientation = ReadOrientation(frame.Get());
  decoded.pixels = ApplyOrientation(std::move(pixels), decoded.orientation);
  return decoded;
}

}  // namespace photoy

#else  // _WIN32

namespace photoy {

/**
 * Everywhere else, for now.
 *
 * The macOS implementation is ImageIO and belongs beside this rather than
 * inside it, the same way the graphics abstraction is split - a platform is a
 * file, not a branch. Until one exists, a HEIC is refused with a sentence that
 * says what is missing rather than pretending the format is unknown.
 */
DecodedImage DecodeHeif(const std::vector<std::uint8_t>&) {
  throw EngineException(error_code::kUnsupportedFormat, "HEIC is not supported in this build",
                        "no platform codec is wired up for this operating system yet");
}

}  // namespace photoy

#endif  // _WIN32
