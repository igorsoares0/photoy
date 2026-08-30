#include "color/pipeline.h"

#include <lcms2.h>

#include <algorithm>
#include <map>
#include <mutex>
#include <utility>

#include "color/output.h"
#include "core/error.h"
#include "core/log.h"

namespace photoy::color {
namespace {

/**
 * Relative colorimetric with black point compensation.
 *
 * Going into the working space this is effectively lossless, because the
 * working gamut contains every source gamut we expect. Coming back out it is
 * the honest choice: the synthetic output profiles carry no perceptual table,
 * so asking for perceptual would silently fall back to this anyway.
 */
constexpr cmsUInt32Number kIntent = INTENT_RELATIVE_COLORIMETRIC;

/// COPY_ALPHA is required: without it lcms leaves the extra channel untouched,
/// which on a freshly allocated buffer means a fully transparent result.
constexpr cmsUInt32Number kFlags =
    cmsFLAGS_COPY_ALPHA | cmsFLAGS_BLACKPOINTCOMPENSATION | cmsFLAGS_HIGHRESPRECALC;

class Transform {
 public:
  Transform() = default;
  explicit Transform(cmsHTRANSFORM handle) : handle_(handle) {}
  ~Transform() {
    if (handle_ != nullptr) cmsDeleteTransform(handle_);
  }
  Transform(Transform&& other) noexcept : handle_(std::exchange(other.handle_, nullptr)) {}
  Transform& operator=(Transform&& other) noexcept {
    if (this != &other) {
      if (handle_ != nullptr) cmsDeleteTransform(handle_);
      handle_ = std::exchange(other.handle_, nullptr);
    }
    return *this;
  }
  Transform(const Transform&) = delete;
  Transform& operator=(const Transform&) = delete;

  cmsHTRANSFORM get() const noexcept { return handle_; }
  bool valid() const noexcept { return handle_ != nullptr; }

 private:
  cmsHTRANSFORM handle_ = nullptr;
};


/// Used only for the source-profile conversion at open time, where the profile
/// is arbitrary and lcms is the only thing that can interpret it.
template <typename In, typename Out>
void RunTransform(cmsHTRANSFORM transform, const TImageBuffer<In>& source,
                  TImageBuffer<Out>& target) {
  cmsDoTransformLineStride(transform, source.data(), target.data(),
                           static_cast<cmsUInt32Number>(source.width()),
                           static_cast<cmsUInt32Number>(source.height()),
                           static_cast<cmsUInt32Number>(source.stride()),
                           static_cast<cmsUInt32Number>(target.stride()), 0, 0);
}

}  // namespace

Image16 ToWorking(const Image16& source, const Profile& source_profile) {
  if (source.empty()) return {};

  const Profile fallback = source_profile.valid() ? Profile() : Profile::Srgb();
  const Profile& input = source_profile.valid() ? source_profile : fallback;
  const Profile working = Profile::Working();
  if (!input.valid() || !working.valid()) {
    throw EngineException(error_code::kInternalError, "Could not build a colour profile",
                          "source to working");
  }

  // Built per document rather than cached: this runs once per open, and the
  // source profile is different almost every time.
  cmsHTRANSFORM handle = cmsCreateTransform(input.handle(), TYPE_RGBA_16, working.handle(),
                                            TYPE_RGBA_16, kIntent, kFlags);
  if (handle == nullptr) {
    throw EngineException(error_code::kInternalError, "Could not build a colour transform",
                          "source to working");
  }
  const Transform transform{handle};

  Image16 result = Image16::Create(source.width(), source.height());
  RunTransform(transform.get(), source, result);
  return result;
}

Image8 ToOutput8(const Image16& working, OutputSpace space, const CancellationTokenPtr& token) {
  if (working.empty()) return {};
  Image8 result = Image8::Create(working.width(), working.height());
  ConvertBanded(working, result, space, token, NoPreProcess{});
  return result;
}

Image16 ToOutput16(const Image16& working, OutputSpace space, const CancellationTokenPtr& token) {
  if (working.empty()) return {};
  Image16 result = Image16::Create(working.width(), working.height());
  ConvertBanded(working, result, space, token, NoPreProcess{});
  return result;
}

}  // namespace photoy::color
