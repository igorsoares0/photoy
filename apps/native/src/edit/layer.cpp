#include "edit/layer.h"

#include <algorithm>
#include <cmath>

#include "color/matrix.h"
#include "edit/detail.h"
#include "color/primaries.h"

namespace photoy {
namespace {

/// The sRGB transfer curve, inverted: a picked colour arrives encoded.
float DecodeSrgb(float encoded) noexcept {
  if (encoded <= 0.04045f) return encoded / 12.92f;
  return std::pow((encoded + 0.055f) / 1.055f, 2.4f);
}

/// Below this coverage a pixel is too nearly background to unmix usefully.
constexpr float kUnmixFloor = 0.1f;
/// Headroom the solved colour is allowed, in linear working-space units.
constexpr float kUnmixCeiling = 4.0f;

float SoftLight(float under, float over) noexcept {
  // The W3C formulation, which is the one that matches what other editors call
  // soft light.
  if (over <= 0.5f) return under - (1.0f - 2.0f * over) * under * (1.0f - under);
  const float d = under <= 0.25f ? ((16.0f * under - 12.0f) * under + 4.0f) * under
                                 : std::sqrt(std::max(0.0f, under));
  return under + (2.0f * over - 1.0f) * (d - under);
}

}  // namespace

const char* LayerKindName(LayerKind kind) noexcept {
  switch (kind) {
    case LayerKind::kBackground: return "background";
    case LayerKind::kMatte: return "matte";
    case LayerKind::kPatch: return "patch";
    case LayerKind::kAdjustment: break;
  }
  return "adjustment";
}

LayerKind LayerKindFromName(const std::string& name) noexcept {
  if (name == "matte") return LayerKind::kMatte;
  if (name == "patch") return LayerKind::kPatch;
  if (name == "background") return LayerKind::kBackground;
  return LayerKind::kAdjustment;
}

const char* FillKindName(FillKind kind) noexcept {
  switch (kind) {
    case FillKind::kColor: return "color";
    case FillKind::kBlur: return "blur";
    case FillKind::kImage: return "image";
    case FillKind::kTransparent: break;
  }
  return "transparent";
}

FillKind FillKindFromName(const std::string& name) noexcept {
  if (name == "color") return FillKind::kColor;
  if (name == "blur") return FillKind::kBlur;
  if (name == "image") return FillKind::kImage;
  return FillKind::kTransparent;
}

const char* BlendModeName(BlendMode mode) noexcept {
  switch (mode) {
    case BlendMode::kMultiply: return "multiply";
    case BlendMode::kScreen: return "screen";
    case BlendMode::kOverlay: return "overlay";
    case BlendMode::kSoftLight: return "soft-light";
    case BlendMode::kNormal: break;
  }
  return "normal";
}

BlendMode BlendModeFromName(const std::string& name) noexcept {
  if (name == "multiply") return BlendMode::kMultiply;
  if (name == "screen") return BlendMode::kScreen;
  if (name == "overlay") return BlendMode::kOverlay;
  if (name == "soft-light") return BlendMode::kSoftLight;
  return BlendMode::kNormal;
}

float Blend(BlendMode mode, float under, float over) noexcept {
  switch (mode) {
    case BlendMode::kMultiply: return under * over;
    case BlendMode::kScreen: return under + over - under * over;
    case BlendMode::kOverlay:
      return under <= 0.5f ? 2.0f * under * over : 1.0f - 2.0f * (1.0f - under) * (1.0f - over);
    case BlendMode::kSoftLight: return SoftLight(under, over);
    case BlendMode::kNormal: break;
  }
  return over;
}

CompiledLayer::CompiledLayer(const Layer& layer, int width, int height, const MaskBuffer* raster,
                             const FittedPatch* patch, double scale)
    : kind_(layer.kind),
      fill_(layer.fill),
      adjustments_(layer.adjustments, width, height, scale),
      mask_(layer.mask, width, height, raster),
      blend_(layer.blend),
      opacity_(std::clamp(layer.opacity, 0.0f, 1.0f)),
      patch_(patch),
      raw_adjustments_(layer.adjustments) {
  if (kind_ == LayerKind::kPatch) {
    // A patch without its pixels - stale, or not yet generated - draws nothing
    // rather than drawing a hole.
    transparent_ = opacity_ <= 0.0f || patch_ == nullptr || patch_->empty();
    return;
  }

  if (kind_ == LayerKind::kMatte) {
    // A matte with nothing to mask covers the whole frame, which leaves it
    // exactly as it found it.
    transparent_ = opacity_ <= 0.0f || mask_.open();
    decontaminate_ = std::clamp(layer.decontaminate, 0.0f, 1.0f);
    if (fill_ == FillKind::kBlur) {
      // The grid is the resolution the blur is built at and the smoothing is
      // its radius in cells. A heavy blur is smooth by construction, so nothing
      // is lost by building it small and sampling it back up - and it costs a
      // sixteenth of what the full frame would.
      const float amount = std::clamp(layer.blur, 0.0f, 100.0f) / 100.0f;
      backdrop_smoothing_ = std::max(1, static_cast<int>(std::lround(1.0f + amount * 22.0f)));
      backdrop_grid_ = 256;
    }
    if (fill_ == FillKind::kColor) {
      // The picked colour is sRGB; the composite is linear working space. The
      // conversion happens once here rather than once per pixel.
      const color::Mat3 to_working = color::Invert(color::WorkingToLinear(color::kSrgbSpace));
      const float linear[3] = {DecodeSrgb(layer.color.r), DecodeSrgb(layer.color.g),
                               DecodeSrgb(layer.color.b)};
      for (int row = 0; row < 3; ++row) {
        fill_color_[row] = static_cast<float>(to_working.At(row, 0) * linear[0] +
                                              to_working.At(row, 1) * linear[1] +
                                              to_working.At(row, 2) * linear[2]);
      }
    }
    return;
  }

  // Sharpening and clarity happen in their own pass, so a layer that carries
  // only those is not transparent even though its per-pixel work is neutral.
  // With a mask the mix varies per pixel, so the replacement shortcut is off.
  passthrough_ = blend_ == BlendMode::kNormal && opacity_ >= 1.0f && mask_.open();
  // Under a normal blend a neutral adjustment mixes a value with itself, which
  // is nothing whatever the opacity or the mask say.
  transparent_ = opacity_ <= 0.0f || (adjustments_.neutral() && blend_ == BlendMode::kNormal);
}

void CompiledLayer::ApplyDetailTo(Image16& image, double scale,
                                  const CancellationTokenPtr& token) const {
  if (kind_ != LayerKind::kAdjustment || opacity_ <= 0.0f) return;
  ApplyDetail(image, raw_adjustments_, mask_, opacity_, scale, token);
}

void CompiledLayer::Apply(float& r, float& g, float& b, float& a, int x, int y) const noexcept {
  if (transparent_) return;

  if (kind_ == LayerKind::kPatch) {
    const int px = x - patch_->x;
    const int py = y - patch_->y;
    if (px < 0 || py < 0 || px >= patch_->pixels.width() || py >= patch_->pixels.height()) return;

    // The mask says how much of what the model invented to use, so the marked
    // area can be trimmed afterwards without the model running again.
    const float coverage = opacity_ * mask_.At(x, y);
    if (coverage <= 0.0f) return;

    constexpr float kFromSample = 1.0f / 65535.0f;
    const std::uint16_t* pixel =
        patch_->pixels.Row(py) + static_cast<std::size_t>(px) * kChannels;
    r += (pixel[0] * kFromSample - r) * coverage;
    g += (pixel[1] * kFromSample - g) * coverage;
    b += (pixel[2] * kFromSample - b) * coverage;
    return;
  }

  if (kind_ == LayerKind::kMatte) {
    // The mask marks what stays. Everything else is what the fill replaces.
    const float keep = opacity_ < 1.0f ? 1.0f - opacity_ * (1.0f - mask_.At(x, y))
                                       : mask_.At(x, y);

    // Along a soft edge the pixel is a mixture: C = F*keep + B*(1 - keep).
    // Solving that for F is what stops the old background travelling into the
    // new one. Only the partly-covered pixels are mixtures, and below a tenth
    // of coverage the division is dominated by whatever B got wrong, so those
    // are left alone - they are barely visible in the result either way.
    if (background_ != nullptr && keep > kUnmixFloor && keep < 1.0f) {
      float behind[3];
      background_->SampleAt(x, y, behind);
      const float missing = 1.0f - keep;
      const float inverse = 1.0f / keep;
      const auto unmix = [&](float channel, float under) {
        // The working space carries highlights above 1, so the ceiling is
        // headroom rather than white; the floor is what light cannot go below.
        const float solved = std::clamp((channel - under * missing) * inverse, 0.0f, kUnmixCeiling);
        return channel + (solved - channel) * decontaminate_;
      };
      r = unmix(r, behind[0]);
      g = unmix(g, behind[1]);
      b = unmix(b, behind[2]);
    }

    if (fill_ == FillKind::kTransparent) {
      a *= keep;
      return;
    }
    // Standard over-compositing with unpremultiplied colour: what is left of
    // the photograph sits on top of an opaque fill.
    float fill[3] = {fill_color_[0], fill_color_[1], fill_color_[2]};
    if (fill_ == FillKind::kBlur) {
      if (backdrop_ == nullptr) return;
      backdrop_->SampleAt(x, y, fill);
    } else if (fill_ == FillKind::kImage) {
      // A backdrop that has not arrived - never chosen, or made for a different
      // crop - leaves the photograph as it is rather than punching a hole.
      if (patch_ == nullptr || patch_->empty()) return;
      const int px = std::clamp(x - patch_->x, 0, patch_->pixels.width() - 1);
      const int py = std::clamp(y - patch_->y, 0, patch_->pixels.height() - 1);
      const std::uint16_t* pixel =
          patch_->pixels.Row(py) + static_cast<std::size_t>(px) * kChannels;
      constexpr float kFromSample = 1.0f / 65535.0f;
      for (int c = 0; c < 3; ++c) fill[c] = pixel[c] * kFromSample;
    }
    const float subject = a * keep;
    const float behind = 1.0f - keep;
    const float result = subject + behind;
    if (result > 0.0f) {
      r = (r * subject + fill[0] * behind) / result;
      g = (g * subject + fill[1] * behind) / result;
      b = (b * subject + fill[2] * behind) / result;
    }
    a = result;
    return;
  }

  const float coverage = opacity_ * mask_.At(x, y);
  if (coverage <= 0.0f) return;

  float ar = r;
  float ag = g;
  float ab = b;
  adjustments_.Apply(ar, ag, ab, x, y);

  if (passthrough_) {
    r = ar;
    g = ag;
    b = ab;
    return;
  }

  // Blend modes are defined on values in 0-1; the working space carries
  // highlights above that, so they are clamped for the mix and the result is
  // let back out unbounded. Coverage is opacity and mask together: they are the
  // same thing to the mix, one constant and one varying.
  const auto mix = [this, coverage](float under, float over) {
    const float blended = Blend(blend_, std::clamp(under, 0.0f, 1.0f), std::clamp(over, 0.0f, 1.0f));
    return under + (blended - under) * coverage;
  };
  r = mix(r, ar);
  g = mix(g, ag);
  b = mix(b, ab);
}

}  // namespace photoy
