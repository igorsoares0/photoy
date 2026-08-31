#include "edit/layer.h"

#include <algorithm>
#include <cmath>

namespace photoy {
namespace {

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
  return kind == LayerKind::kBackground ? "background" : "adjustment";
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
    : adjustments_(layer.adjustments),
      mask_(layer.mask, width, height, raster),
      blend_(layer.blend),
      opacity_(std::clamp(layer.opacity, 0.0f, 1.0f)) {
  // With a mask the mix varies per pixel, so the replacement shortcut is off.
  passthrough_ = blend_ == BlendMode::kNormal && opacity_ >= 1.0f && mask_.open();
  // Under a normal blend a neutral adjustment mixes a value with itself, which
  // is nothing whatever the opacity or the mask say.
  transparent_ = opacity_ <= 0.0f || (adjustments_.neutral() && blend_ == BlendMode::kNormal);
}

void CompiledLayer::Apply(float& r, float& g, float& b, int x, int y) const noexcept {
  if (transparent_) return;

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
