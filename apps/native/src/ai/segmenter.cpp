#include "ai/segmenter.h"

#include <algorithm>
#include <cmath>

#include "color/pipeline.h"
#include "core/error.h"
#include "image/resample.h"

namespace photoy::ai {
namespace {

/// The statistics U^2-Net was trained under.
constexpr float kMean[3] = {0.485f, 0.456f, 0.406f};
constexpr float kStd[3] = {0.229f, 0.224f, 0.225f};

void Check(const CancellationTokenPtr& token) {
  if (token->cancelled()) {
    throw EngineException(error_code::kCancelled, "Segmentation cancelled", "superseded");
  }
}

}  // namespace

MaskBuffer Segment(const Image16& working, Session& session, const CancellationTokenPtr& token) {
  if (working.empty()) {
    throw EngineException(error_code::kInvalidRequest, "Nothing to segment", "empty image");
  }
  const int side = session.input_side();
  Check(token);

  // Reduced in the working space, so the averaging happens in linear light, and
  // only then converted to the encoding the model was trained on.
  const Image16 reduced = DownscaleBox(working, Rect{0, 0, working.width(), working.height()},
                                       side, side, token);
  const Image8 rgb = color::ToOutput8(reduced, color::OutputSpace::kSrgb, token);
  Check(token);

  // The reference implementation scales by the image maximum rather than by
  // 255, so a dark photograph is normalised the way it was during training.
  std::uint8_t maximum = 1;
  for (int y = 0; y < rgb.height(); ++y) {
    const std::uint8_t* row = rgb.Row(y);
    for (int x = 0; x < rgb.width() * kChannels; ++x) {
      if ((x % kChannels) != 3) maximum = std::max(maximum, row[x]);
    }
  }
  const float scale = 1.0f / static_cast<float>(maximum);

  std::vector<float> input(static_cast<std::size_t>(3) * side * side);
  for (int y = 0; y < side; ++y) {
    const std::uint8_t* row = rgb.Row(y);
    for (int x = 0; x < side; ++x) {
      for (int c = 0; c < 3; ++c) {
        const float value = row[static_cast<std::size_t>(x) * kChannels + c] * scale;
        input[(static_cast<std::size_t>(c) * side + y) * side + x] = (value - kMean[c]) / kStd[c];
      }
    }
  }
  Check(token);

  const std::vector<float> prediction = session.Run(input);
  Check(token);

  // The network's range is arbitrary, so it is normalised to its own extremes.
  const auto [low, high] = std::minmax_element(prediction.begin(), prediction.end());
  const float range = *high > *low ? *high - *low : 1.0f;

  MaskBuffer small;
  small.width = side;
  small.height = side;
  small.coverage.resize(prediction.size());
  for (std::size_t i = 0; i < prediction.size(); ++i) {
    const float normalised = std::clamp((prediction[i] - *low) / range, 0.0f, 1.0f);
    small.coverage[i] = static_cast<std::uint8_t>(normalised * 255.0f + 0.5f);
  }
  Check(token);

  return Resize(small, working.width(), working.height());
}

}  // namespace photoy::ai
