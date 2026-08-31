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

MaskBuffer Resize(const MaskBuffer& source, int width, int height) {
  if (source.empty() || width <= 0 || height <= 0) return {};
  if (source.width == width && source.height == height) return source;

  MaskBuffer result;
  result.width = width;
  result.height = height;
  result.coverage.resize(static_cast<std::size_t>(width) * height);

  for (int y = 0; y < height; ++y) {
    const float sy = (y + 0.5f) * source.height / height - 0.5f;
    const int y0 = std::clamp(static_cast<int>(std::floor(sy)), 0, source.height - 1);
    const int y1 = std::min(y0 + 1, source.height - 1);
    const float fy = std::clamp(sy - static_cast<float>(y0), 0.0f, 1.0f);

    for (int x = 0; x < width; ++x) {
      const float sx = (x + 0.5f) * source.width / width - 0.5f;
      const int x0 = std::clamp(static_cast<int>(std::floor(sx)), 0, source.width - 1);
      const int x1 = std::min(x0 + 1, source.width - 1);
      const float fx = std::clamp(sx - static_cast<float>(x0), 0.0f, 1.0f);

      const float top = source.At(x0, y0) + (source.At(x1, y0) - source.At(x0, y0)) * fx;
      const float bottom = source.At(x0, y1) + (source.At(x1, y1) - source.At(x0, y1)) * fx;
      result.coverage[static_cast<std::size_t>(y) * width + x] =
          static_cast<std::uint8_t>(top + (bottom - top) * fy + 0.5f);
    }
  }
  return result;
}

const char* MaskKindName(MaskKind kind) noexcept {
  switch (kind) {
    case MaskKind::kLinear: return "linear";
    case MaskKind::kRadial: return "radial";
    case MaskKind::kRaster: return "raster";
    case MaskKind::kNone: break;
  }
  return "none";
}

MaskKind MaskKindFromName(const std::string& name) noexcept {
  if (name == "linear") return MaskKind::kLinear;
  if (name == "radial") return MaskKind::kRadial;
  if (name == "raster") return MaskKind::kRaster;
  return MaskKind::kNone;
}

bool Mask::operator==(const Mask& other) const noexcept {
  return kind == other.kind && x == other.x && y == other.y && angle == other.angle &&
         radius == other.radius && feather == other.feather && invert == other.invert &&
         raster == other.raster;
}

CompiledMask::CompiledMask(const Mask& mask, int width, int height, const MaskBuffer* raster)
    : raster_(raster) {
  // A raster mask without its buffer - stale, or not yet generated - lets
  // everything through rather than guessing.
  open_ = mask.IsNone() || width <= 0 || height <= 0 ||
          (mask.kind == MaskKind::kRaster && (raster == nullptr || raster->empty()));
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
  if (kind_ == MaskKind::kRaster) {
    // The buffer is resampled to the render size before it gets here, so this
    // is a lookup and nothing more.
    const int px = std::clamp(x, 0, raster_->width - 1);
    const int py = std::clamp(y, 0, raster_->height - 1);
    coverage = raster_->At(px, py) * (1.0f / 255.0f);
  } else if (kind_ == MaskKind::kLinear) {
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
