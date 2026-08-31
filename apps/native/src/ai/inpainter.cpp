#include "ai/inpainter.h"

#include <algorithm>
#include <cmath>

#include "color/pipeline.h"
#include "core/error.h"
#include "image/resample.h"

namespace photoy::ai {
namespace {

/// Coverage above which a pixel counts as marked for removal.
constexpr std::uint8_t kMarked = 8;
/// Smallest window worth handing the model, in pixels.
constexpr int kMinWindow = 64;

/**
 * Whether the model reads its channels in BGR order.
 *
 * Determined by measurement, not by reading: the reference implementation feeds
 * it an OpenCV image without swapping, and an image that leaves OpenCV's reader
 * is BGR. `tests/engine/inpaint.mjs` fills a frame with a single strong hue and
 * checks that what comes back matches it; a model fed the wrong order returns
 * the complement and that test fails loudly.
 */
constexpr bool kModelWantsBgr = true;

void Check(const CancellationTokenPtr& token) {
  if (token->cancelled()) {
    throw EngineException(error_code::kCancelled, "Inpainting cancelled", "superseded");
  }
}

}  // namespace

Rect MarkedBounds(const MaskBuffer& mask) noexcept {
  if (mask.empty()) return Rect{0, 0, 0, 0};

  int left = mask.width;
  int top = mask.height;
  int right = -1;
  int bottom = -1;
  for (int y = 0; y < mask.height; ++y) {
    for (int x = 0; x < mask.width; ++x) {
      if (mask.At(x, y) < kMarked) continue;
      left = std::min(left, x);
      top = std::min(top, y);
      right = std::max(right, x);
      bottom = std::max(bottom, y);
    }
  }
  if (right < 0) return Rect{0, 0, 0, 0};
  return Rect{left, top, right - left + 1, bottom - top + 1};
}

Rect InpaintWindow(const Rect& marked, int image_width, int image_height) {
  if (marked.empty() || image_width <= 0 || image_height <= 0) return Rect{0, 0, 0, 0};

  // Half the mark again on every side, so the model sees as much of the
  // surroundings as it is being asked to invent.
  const int longest = std::max(marked.width, marked.height);
  int side = std::max(kMinWindow, longest * 2);
  side = std::min(side, std::max(image_width, image_height));

  // Square, because the window is resampled to a square input and a rectangle
  // would reach the model stretched.
  const int width = std::min(side, image_width);
  const int height = std::min(side, image_height);

  const int centre_x = marked.x + marked.width / 2;
  const int centre_y = marked.y + marked.height / 2;
  const int x = std::clamp(centre_x - width / 2, 0, std::max(0, image_width - width));
  const int y = std::clamp(centre_y - height / 2, 0, std::max(0, image_height - height));
  return Rect{x, y, width, height};
}

Patch Inpaint(const Image16& working, const MaskBuffer& mask, Session& session,
              const CancellationTokenPtr& token) {
  if (working.empty()) {
    throw EngineException(error_code::kInvalidRequest, "Nothing to fill", "empty image");
  }
  const MaskBuffer fitted = (mask.width == working.width() && mask.height == working.height())
                                ? mask
                                : Resize(mask, working.width(), working.height());
  const Rect marked = MarkedBounds(fitted);
  if (marked.empty()) {
    throw EngineException(error_code::kInvalidRequest, "Nothing is marked",
                          "the mask selects no pixels to fill");
  }
  Check(token);

  const Rect window = InpaintWindow(marked, working.width(), working.height());
  const int side = session.input_side();

  // Reduced in the working space, so the averaging happens in linear light, and
  // only then converted to the encoding the model was trained on.
  const Image16 region = ResampleTo(working, window, side, side, token);
  const Image8 rgb = color::ToOutput8(region, color::OutputSpace::kSrgb, token);
  Check(token);

  MaskBuffer window_mask;
  window_mask.width = window.width;
  window_mask.height = window.height;
  window_mask.coverage.resize(static_cast<std::size_t>(window.width) * window.height);
  for (int y = 0; y < window.height; ++y) {
    for (int x = 0; x < window.width; ++x) {
      window_mask.coverage[static_cast<std::size_t>(y) * window.width + x] =
          fitted.At(window.x + x, window.y + y);
    }
  }
  const MaskBuffer small_mask = Resize(window_mask, side, side);
  Check(token);

  const std::size_t plane = static_cast<std::size_t>(side) * side;
  std::vector<float> image_input(plane * 3);
  std::vector<float> mask_input(plane);
  for (int y = 0; y < side; ++y) {
    const std::uint8_t* row = rgb.Row(y);
    for (int x = 0; x < side; ++x) {
      for (int c = 0; c < 3; ++c) {
        const int channel = kModelWantsBgr ? 2 - c : c;
        image_input[(static_cast<std::size_t>(c) * side + y) * side + x] =
            row[static_cast<std::size_t>(x) * kChannels + channel] * (1.0f / 255.0f);
      }
      // Binary, the way the reference implementation feeds it: the model is
      // being told where to invent, not by how much.
      mask_input[static_cast<std::size_t>(y) * side + x] =
          small_mask.At(x, y) >= kMarked ? 1.0f : 0.0f;
    }
  }
  Check(token);

  const std::array<std::int64_t, 4> image_shape{1, 3, side, side};
  const std::array<std::int64_t, 4> mask_shape{1, 1, side, side};
  const std::vector<float> prediction =
      session.RunNamed({"image", "mask"}, {image_input, mask_input}, {image_shape, mask_shape});
  Check(token);
  if (prediction.size() < plane * 3) {
    throw EngineException(error_code::kInternalError, "The model returned too little",
                          std::to_string(prediction.size()) + " values");
  }

  // The model answers in 0-255 sRGB, which is what a patch is stored as: it is
  // the whole of what the model knows, so converting and resampling it here
  // would be storing interpolation and calling it detail. The blend against the
  // mask happens at composite time, where the mask can still be changed.
  Patch patch;
  patch.region = window;
  patch.pixels = Image8::Create(side, side);
  for (int y = 0; y < side; ++y) {
    std::uint8_t* row = patch.pixels.Row(y);
    for (int x = 0; x < side; ++x) {
      const std::size_t index = static_cast<std::size_t>(x) * kChannels;
      for (int c = 0; c < 3; ++c) {
        const int channel = kModelWantsBgr ? 2 - c : c;
        const float value =
            prediction[(static_cast<std::size_t>(channel) * side + y) * side + x];
        row[index + c] = static_cast<std::uint8_t>(std::clamp(value, 0.0f, 255.0f) + 0.5f);
      }
      row[index + 3] = 255;
    }
  }
  return patch;
}

}  // namespace photoy::ai
