#include "ai/denoiser.h"

#include <algorithm>
#include <cmath>

#include "color/matrix.h"
#include "color/pipeline.h"
#include "color/primaries.h"
#include "core/error.h"

namespace photoy::ai {
namespace {

/// The network halves its resolution this many times, so its input must divide.
constexpr int kSizeMultiple = 64;

void Check(const CancellationTokenPtr& token) {
  if (token->cancelled()) {
    throw EngineException(error_code::kCancelled, "Denoise cancelled", "superseded");
  }
}

float DecodeSrgb(float encoded) noexcept {
  if (encoded <= 0.04045f) return encoded / 12.92f;
  return std::pow((encoded + 0.055f) / 1.055f, 2.4f);
}

}  // namespace

Image16 Denoise(const Image16& working, Session& session, const CancellationTokenPtr& token) {
  if (working.empty()) {
    throw EngineException(error_code::kInvalidRequest, "Nothing to denoise", "empty image");
  }
  const int width = working.width();
  const int height = working.height();

  // Converted to the encoding the model was trained on, which is also where
  // noise looks the way it looked during training.
  const Image8 encoded = color::ToOutput8(working, color::OutputSpace::kSrgb, token);
  Check(token);

  // Padded up to what the network can divide, by repeating the edge rather than
  // filling with black: a black border would read as an enormous edge and the
  // model would spend its attention on it.
  const int padded_width = (width + kSizeMultiple - 1) / kSizeMultiple * kSizeMultiple;
  const int padded_height = (height + kSizeMultiple - 1) / kSizeMultiple * kSizeMultiple;
  const std::size_t plane = static_cast<std::size_t>(padded_width) * padded_height;

  std::vector<float> input(plane * 3);
  for (int y = 0; y < padded_height; ++y) {
    const std::uint8_t* row = encoded.Row(std::min(y, height - 1));
    for (int x = 0; x < padded_width; ++x) {
      const std::size_t source = static_cast<std::size_t>(std::min(x, width - 1)) * kChannels;
      for (int c = 0; c < 3; ++c) {
        input[(static_cast<std::size_t>(c) * padded_height + y) * padded_width + x] =
            row[source + c] * (1.0f / 255.0f);
      }
    }
  }
  Check(token);

  const std::array<std::int64_t, 4> shape{1, 3, padded_height, padded_width};
  const std::vector<float> prediction = session.RunNamed({"image"}, {input}, {shape});
  Check(token);
  if (prediction.size() < plane * 3) {
    throw EngineException(error_code::kInternalError, "The model returned too little",
                          std::to_string(prediction.size()) + " values");
  }

  // Back to the working space by the same matrix the export uses, which is the
  // exact inverse of the conversion above.
  const color::Mat3 to_working = color::Invert(color::WorkingToLinear(color::kSrgbSpace));
  Image16 result = Image16::Create(width, height);
  for (int y = 0; y < height; ++y) {
    const std::uint16_t* source = working.Row(y);
    std::uint16_t* row = result.Row(y);
    for (int x = 0; x < width; ++x) {
      float linear[3];
      for (int c = 0; c < 3; ++c) {
        const float value =
            prediction[(static_cast<std::size_t>(c) * padded_height + y) * padded_width + x];
        linear[c] = DecodeSrgb(std::clamp(value, 0.0f, 1.0f));
      }
      const std::size_t index = static_cast<std::size_t>(x) * kChannels;
      for (int out = 0; out < 3; ++out) {
        const float mixed = static_cast<float>(to_working.At(out, 0) * linear[0] +
                                               to_working.At(out, 1) * linear[1] +
                                               to_working.At(out, 2) * linear[2]);
        row[index + out] =
            static_cast<std::uint16_t>(std::clamp(mixed, 0.0f, 1.0f) * 65535.0f + 0.5f);
      }
      // Alpha is not noise and the model never saw it.
      row[index + 3] = source[index + 3];
    }
  }
  return result;
}

}  // namespace photoy::ai
