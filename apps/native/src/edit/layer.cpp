#include "edit/layer.h"

#include <algorithm>
#include <cmath>

#include "color/matrix.h"
#include "color/primaries.h"

namespace photoy {
namespace {

/// The sRGB transfer curve, inverted: a picked colour arrives encoded.
float DecodeSrgb(float encoded) noexcept {
  if (encoded <= 0.04045f) return encoded / 12.92f;
  return std::pow((encoded + 0.055f) / 1.055f, 2.4f);
}

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
    case LayerKind::kAdjustment: break;
  }
  return "adjustment";
}

const char* FillKindName(FillKind kind) noexcept {
  return kind == FillKind::kColor ? "color" : "transparent";
}

FillKind FillKindFromName(const std::string& name) noexcept {
  return name == "color" ? FillKind::kColor : FillKind::kTransparent;
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

CompiledLayer::CompiledLayer(const Layer& layer, int width, int height, const MaskBuffer* raster)
    : kind_(layer.kind),
      fill_(layer.fill),
      adjustments_(layer.adjustments),
      mask_(layer.mask, width, height, raster),
      blend_(layer.blend),
      opacity_(std::clamp(layer.opacity, 0.0f, 1.0f)) {
  if (kind_ == LayerKind::kMatte) {
    // A matte with nothing to mask covers the whole frame, which leaves it
    // exactly as it found it.
    transparent_ = opacity_ <= 0.0f || mask_.open();
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

  // With a mask the mix varies per pixel, so the replacement shortcut is off.
  passthrough_ = blend_ == BlendMode::kNormal && opacity_ >= 1.0f && mask_.open();
  // Under a normal blend a neutral adjustment mixes a value with itself, which
  // is nothing whatever the opacity or the mask say.
  transparent_ = opacity_ <= 0.0f || (adjustments_.neutral() && blend_ == BlendMode::kNormal);
}

void CompiledLayer::Apply(float& r, float& g, float& b, float& a, int x, int y) const noexcept {
  if (transparent_) return;

  if (kind_ == LayerKind::kMatte) {
    // The mask marks what stays. Everything else is what the fill replaces.
    const float keep = opacity_ < 1.0f ? 1.0f - opacity_ * (1.0f - mask_.At(x, y))
                                       : mask_.At(x, y);
    if (fill_ == FillKind::kTransparent) {
      a *= keep;
      return;
    }
    // Standard over-compositing with unpremultiplied colour: what is left of
    // the photograph sits on top of an opaque fill.
    const float subject = a * keep;
    const float behind = 1.0f - keep;
    const float result = subject + behind;
    if (result > 0.0f) {
      r = (r * subject + fill_color_[0] * behind) / result;
      g = (g * subject + fill_color_[1] * behind) / result;
      b = (b * subject + fill_color_[2] * behind) / result;
    }
    a = result;
    return;
  }

  const float coverage = opacity_ * mask_.At(x, y);
  if (coverage <= 0.0f) return;

  float ar = r;
  float ag = g;
  float ab = b;
  adjustments_.Apply(ar, ag, ab);

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
