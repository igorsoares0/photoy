/**
 * Writes a HEIC from a PNG using the platform's own codec.
 *
 * A test fixture generator rather than part of the product. HEIC cannot be
 * generated the way the PNG fixtures are - there is no encoder in the tree and
 * there deliberately never will be - so it is made by the same operating-system
 * codec that reads it back, on a machine that has one. Where there is none, no
 * fixture appears and the HEIC tests skip, which is the honest outcome: without
 * the codec the feature does not work there either.
 *
 * It carries over the source's colour profile and can be told to declare an
 * orientation, because those are the two things a photograph out of a phone has
 * that a plain conversion does not - and the two paths in the decoder most
 * likely to be wrong without anybody noticing.
 */
#ifdef _WIN32

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif

#include <windows.h>
#include <wincodec.h>
#include <wrl/client.h>

#include <cstdio>
#include <cstdlib>

using Microsoft::WRL::ComPtr;

int wmain(int argc, wchar_t** argv) {
  if (argc < 3) {
    std::printf("usage: heic-fixture <source.png> <target.heic> [exif-orientation]\n");
    return 2;
  }
  const int orientation = argc > 3 ? _wtoi(argv[3]) : 0;
  if (FAILED(CoInitializeEx(nullptr, COINIT_MULTITHREADED))) return 1;

  ComPtr<IWICImagingFactory> factory;
  if (FAILED(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER,
                              IID_PPV_ARGS(&factory)))) {
    return 1;
  }

  ComPtr<IWICBitmapDecoder> decoder;
  if (FAILED(factory->CreateDecoderFromFilename(argv[1], nullptr, GENERIC_READ,
                                                WICDecodeMetadataCacheOnDemand, &decoder))) {
    std::printf("could not read the source\n");
    return 1;
  }
  ComPtr<IWICBitmapFrameDecode> frame;
  if (FAILED(decoder->GetFrame(0, &frame))) return 1;

  ComPtr<IWICStream> stream;
  if (FAILED(factory->CreateStream(&stream)) ||
      FAILED(stream->InitializeFromFilename(argv[2], GENERIC_WRITE))) {
    return 1;
  }

  ComPtr<IWICBitmapEncoder> encoder;
  if (FAILED(factory->CreateEncoder(GUID_ContainerFormatHeif, nullptr, &encoder))) {
    // Not a failure of this tool: the machine has no HEIF codec, so the fixture
    // is skipped and so are the tests that would have used it.
    std::printf("no HEIF codec on this machine\n");
    return 3;
  }
  if (FAILED(encoder->Initialize(stream.Get(), WICBitmapEncoderNoCache))) return 1;

  ComPtr<IWICBitmapFrameEncode> out;
  if (FAILED(encoder->CreateNewFrame(&out, nullptr)) || FAILED(out->Initialize(nullptr))) {
    return 1;
  }

  // Carry the source's profile across. A photograph from a phone is tagged, and
  // a fixture that is not would leave the colour path untested.
  {
    ComPtr<IWICColorContext> context;
    if (SUCCEEDED(factory->CreateColorContext(&context))) {
      IWICColorContext* contexts[1] = {context.Get()};
      UINT count = 0;
      if (SUCCEEDED(frame->GetColorContexts(1, contexts, &count)) && count > 0) {
        out->SetColorContexts(1, contexts);
      }
    }
  }

  if (orientation > 0) {
    ComPtr<IWICMetadataQueryWriter> writer;
    if (SUCCEEDED(out->GetMetadataQueryWriter(&writer)) && writer != nullptr) {
      PROPVARIANT value;
      PropVariantInit(&value);
      value.vt = VT_UI2;
      value.uiVal = static_cast<USHORT>(orientation);
      // HEIF keeps its own orientation in the container, beside the one EXIF
      // may also carry. Written here because it is the one a real photograph
      // out of a phone uses, and the one a decoder has to read.
      const bool wrote_native = SUCCEEDED(
          writer->SetMetadataByName(L"/heifProps/Orientation", &value));
      const bool wrote_exif = SUCCEEDED(
          writer->SetMetadataByName(L"/ifd/{ushort=274}", &value));
      if (!wrote_native && !wrote_exif) {
        std::printf("could not declare an orientation\n");
        PropVariantClear(&value);
        return 1;
      }
      std::printf("orientation: native=%d exif=%d\n", wrote_native ? 1 : 0, wrote_exif ? 1 : 0);
      PropVariantClear(&value);
    }
  }

  if (FAILED(out->WriteSource(frame.Get(), nullptr)) || FAILED(out->Commit()) ||
      FAILED(encoder->Commit())) {
    std::printf("the codec refused to write\n");
    return 1;
  }
  std::printf("ok\n");
  return 0;
}

#else

int main() { return 3; }  // no platform codec here, so no fixture

#endif  // _WIN32
