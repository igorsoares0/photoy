#include "edit/patch.h"

#include <algorithm>
#include <cmath>

#include "color/matrix.h"
#include "color/primaries.h"
#include "image/resample.h"

namespace photoy {
namespace {

float DecodeSrgb(float encoded) noexcept {
  if (encoded <= 0.04045f) return encoded / 12.92f;
  return std::pow((encoded + 0.055f) / 1.055f, 2.4f);
}

}  // namespace

FittedPatch FitPatch(const PatchBuffer& patch, int render_width, int render_height) {
  FittedPatch fitted;
  if (patch.empty() || render_width <= 0 || render_height <= 0) return fitted;
  if (patch.document_width <= 0 || patch.document_height <= 0) return fitted;

  const double scale_x = static_cast<double>(render_width) / patch.document_width;
  const double scale_y = static_cast<double>(render_height) / patch.document_height;
  const int x = static_cast<int>(std::lround(patch.region.x * scale_x));
  const int y = static_cast<int>(std::lround(patch.region.y * scale_y));
  const int width =
      std::max(1, static_cast<int>(std::lround(patch.region.width * scale_x)));
  const int height =
      std::max(1, static_cast<int>(std::lround(patch.region.height * scale_y)));

  // Out of sRGB by the same matrix the export uses rather than through lcms:
  // this is the exact inverse of the conversion that produced the patch, and it
  // is twenty times faster than the general path for a conversion that is known
  // exactly.
  const color::Mat3 to_working = color::Invert(color::WorkingToLinear(color::kSrgbSpace));
  Image16 working = Image16::Create(patch.pixels.width(), patch.pixels.height());
  for (int row = 0; row < patch.pixels.height(); ++row) {
    const std::uint8_t* source = patch.pixels.Row(row);
    std::uint16_t* target = working.Row(row);
    for (int column = 0; column < patch.pixels.width(); ++column) {
      const std::size_t index = static_cast<std::size_t>(column) * kChannels;
      const float linear[3] = {DecodeSrgb(source[index + 0] * (1.0f / 255.0f)),
                               DecodeSrgb(source[index + 1] * (1.0f / 255.0f)),
                               DecodeSrgb(source[index + 2] * (1.0f / 255.0f))};
      for (int out = 0; out < 3; ++out) {
        const float value = static_cast<float>(to_working.At(out, 0) * linear[0] +
                                               to_working.At(out, 1) * linear[1] +
                                               to_working.At(out, 2) * linear[2]);
        target[index + out] =
            static_cast<std::uint16_t>(std::clamp(value, 0.0f, 1.0f) * 65535.0f + 0.5f);
      }
      target[index + 3] = 65535;
    }
  }

  // Resampled in the working space, so a reduction averages light.
  fitted.x = x;
  fitted.y = y;
  fitted.pixels = ResampleTo(working, Rect{0, 0, working.width(), working.height()}, width,
                             height, NeverCancelled());
  return fitted;
}

}  // namespace photoy
