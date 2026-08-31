#include "edit/mask.h"

#include <algorithm>
#include <cmath>

namespace photoy {
namespace {

float SmoothStep(float edge0, float edge1, float value) noexcept {
  if (edge1 <= edge0) return value < edge0 ? 0.0f : 1.0f;
  const float t = std::clamp((value - edge0) / (edge1 - edge0), 0.0f, 1.0f);
  return t * t * (3.0f - 2.0f * t);
}

}  // namespace

const char* MaskKindName(MaskKind kind) noexcept {
  switch (kind) {
    case MaskKind::kLinear: return "linear";
    case MaskKind::kRadial: return "radial";
    case MaskKind::kNone: break;
  }
  return "none";
}

MaskKind MaskKindFromName(const std::string& name) noexcept {
  if (name == "linear") return MaskKind::kLinear;
  if (name == "radial") return MaskKind::kRadial;
  return MaskKind::kNone;
}

bool Mask::operator==(const Mask& other) const noexcept {
  return kind == other.kind && x == other.x && y == other.y && angle == other.angle &&
         radius == other.radius && feather == other.feather && invert == other.invert;
}

CompiledMask::CompiledMask(const Mask& mask, int width, int height) {
  open_ = mask.IsNone() || width <= 0 || height <= 0;
  if (open_) return;

  kind_ = mask.kind;
  invert_ = mask.invert;
  feather_ = std::max(0.0f, mask.feather);
  radius_ = std::max(0.0f, mask.radius);

  // The shorter side is the unit, so a radial mask stays a circle on a frame
  // that is not square, and a feather means the same distance either way.
  const float shorter = static_cast<float>(std::min(width, height));
  scale_x_ = 1.0f / shorter;
  scale_y_ = 1.0f / shorter;
  centre_x_ = mask.x * static_cast<float>(width);
  centre_y_ = mask.y * static_cast<float>(height);

  direction_x_ = std::sin(mask.angle);
  direction_y_ = std::cos(mask.angle);
}

float CompiledMask::At(int x, int y) const noexcept {
  if (open_) return 1.0f;

  const float dx = (static_cast<float>(x) + 0.5f - centre_x_) * scale_x_;
  const float dy = (static_cast<float>(y) + 0.5f - centre_y_) * scale_y_;

  float coverage = 1.0f;
  if (kind_ == MaskKind::kLinear) {
    // Distance along the gradient direction, zero at the midpoint. The
    // transition is centred on the line, half the feather to each side.
    const float along = dx * direction_x_ + dy * direction_y_;
    coverage = SmoothStep(-feather_ * 0.5f, feather_ * 0.5f, along);
  } else {
    const float distance = std::sqrt(dx * dx + dy * dy);
    // Full inside the radius, falling away across the feather.
    coverage = 1.0f - SmoothStep(radius_, radius_ + feather_, distance);
  }
  return invert_ ? 1.0f - coverage : coverage;
}

}  // namespace photoy
