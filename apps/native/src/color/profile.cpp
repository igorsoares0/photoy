#include "color/profile.h"

#include <lcms2.h>

#include <utility>

namespace photoy::color {
namespace {

cmsCIExyY ToLcms(const Chromaticity& c) { return cmsCIExyY{c.x, c.y, 1.0}; }

cmsCIExyYTRIPLE PrimariesOf(const ColorSpaceDefinition& space) {
  return cmsCIExyYTRIPLE{ToLcms(space.red), ToLcms(space.green), ToLcms(space.blue)};
}

cmsToneCurve* CurveOf(const ColorSpaceDefinition& space) {
  switch (space.transfer) {
    case TransferFunction::kLinear:
      return cmsBuildGamma(nullptr, 1.0);
    case TransferFunction::kPower:
      return cmsBuildGamma(nullptr, space.gamma);
    case TransferFunction::kSrgb:
      break;
  }
  // Parametric type 4: Y = (aX + b)^g for X >= d, else cX.
  const cmsFloat64Number parameters[5] = {2.4, 1.0 / 1.055, 0.055 / 1.055, 1.0 / 12.92, 0.04045};
  return cmsBuildParametricToneCurve(nullptr, 4, parameters);
}

/// Names the profile so a file tagged with it, and the UI reading it back, say
/// something more useful than lcms's default "RGB built-in".
void SetDescription(cmsHPROFILE profile, const wchar_t* description) {
  if (profile == nullptr) return;
  cmsMLU* mlu = cmsMLUalloc(nullptr, 1);
  if (mlu == nullptr) return;
  if (cmsMLUsetWide(mlu, "en", "US", description) != 0) {
    cmsWriteTag(profile, cmsSigProfileDescriptionTag, mlu);
  }
  cmsMLUfree(mlu);
}

/// Builds an ICC profile from the one shared definition of the space.
cmsHPROFILE Build(const ColorSpaceDefinition& space, const wchar_t* description) {
  const cmsCIExyY white = ToLcms(space.white);
  const cmsCIExyYTRIPLE primaries = PrimariesOf(space);
  cmsToneCurve* curve = CurveOf(space);
  cmsToneCurve* curves[3] = {curve, curve, curve};
  cmsHPROFILE profile = cmsCreateRGBProfile(&white, &primaries, curves);
  cmsFreeToneCurve(curve);
  SetDescription(profile, description);
  return profile;
}

}  // namespace

OutputSpace OutputSpaceFromName(const std::string& name) noexcept {
  if (name == "display-p3") return OutputSpace::kDisplayP3;
  if (name == "adobe-rgb") return OutputSpace::kAdobeRgb;
  return OutputSpace::kSrgb;
}

const char* OutputSpaceName(OutputSpace space) noexcept {
  switch (space) {
    case OutputSpace::kDisplayP3: return "display-p3";
    case OutputSpace::kAdobeRgb: return "adobe-rgb";
    default: break;
  }
  return "srgb";
}

Profile::~Profile() {
  if (handle_ != nullptr) cmsCloseProfile(static_cast<cmsHPROFILE>(handle_));
}

Profile::Profile(Profile&& other) noexcept : handle_(std::exchange(other.handle_, nullptr)) {}

Profile& Profile::operator=(Profile&& other) noexcept {
  if (this != &other) {
    if (handle_ != nullptr) cmsCloseProfile(static_cast<cmsHPROFILE>(handle_));
    handle_ = std::exchange(other.handle_, nullptr);
  }
  return *this;
}

Profile Profile::FromIcc(const IccBytes& bytes) {
  if (bytes.empty()) return Profile();
  cmsHPROFILE handle = cmsOpenProfileFromMem(bytes.data(), static_cast<cmsUInt32Number>(bytes.size()));
  if (handle == nullptr) return Profile();

  // Decoders always produce RGB, so a CMYK or greyscale profile does not
  // describe the pixels we are holding. Falling back to sRGB is less wrong than
  // transforming through a profile for a different colour model.
  if (cmsGetColorSpace(handle) != cmsSigRgbData) {
    cmsCloseProfile(handle);
    return Profile();
  }
  return Profile(handle);
}

Profile Profile::Srgb() { return Profile(cmsCreate_sRGBProfile()); }

Profile Profile::DisplayP3() { return Profile(Build(kDisplayP3Space, L"Display P3")); }

Profile Profile::AdobeRgb() {
  return Profile(Build(kAdobeRgbSpace, L"Adobe RGB (1998) compatible"));
}

Profile Profile::Working() {
  return Profile(Build(kWorkingSpace, L"Photoy working space (linear ProPhoto)"));
}

Profile Profile::ForOutput(OutputSpace space) {
  switch (space) {
    case OutputSpace::kDisplayP3: return DisplayP3();
    case OutputSpace::kAdobeRgb: return AdobeRgb();
    default: break;
  }
  return Srgb();
}

IccBytes Profile::Serialize() const {
  if (handle_ == nullptr) return {};
  cmsUInt32Number size = 0;
  if (cmsSaveProfileToMem(static_cast<cmsHPROFILE>(handle_), nullptr, &size) == 0 || size == 0) {
    return {};
  }
  IccBytes bytes(size);
  if (cmsSaveProfileToMem(static_cast<cmsHPROFILE>(handle_), bytes.data(), &size) == 0) {
    return {};
  }
  bytes.resize(size);
  return bytes;
}

std::string Profile::Description() const {
  if (handle_ == nullptr) return {};
  char buffer[256] = {0};
  const cmsUInt32Number written = cmsGetProfileInfoASCII(
      static_cast<cmsHPROFILE>(handle_), cmsInfoDescription, "en", "US", buffer, sizeof(buffer) - 1);
  return written > 0 ? std::string(buffer) : std::string();
}

}  // namespace photoy::color
