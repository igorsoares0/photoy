#include "edit/analysis.h"

#include <algorithm>
#include <cmath>

namespace photoy {

Analysis Analyse(const Image8& encoded) noexcept {
  Analysis analysis;
  if (encoded.empty()) return analysis;

  const int width = encoded.width();
  const int height = encoded.height();
  double sums[3] = {0.0, 0.0, 0.0};
  double chroma = 0.0;
  double detail = 0.0;
  std::uint64_t neighbours = 0;

  for (int y = 0; y < height; ++y) {
    const std::uint8_t* row = encoded.Row(y);
    const std::uint8_t* below = y + 1 < height ? encoded.Row(y + 1) : nullptr;
    for (int x = 0; x < width; ++x) {
      const std::size_t index = static_cast<std::size_t>(x) * kChannels;
      const int r = row[index + 0];
      const int g = row[index + 1];
      const int b = row[index + 2];

      // Rec.709 weights: the frame is already in an sRGB-like encoding by the
      // time it gets here, so these are the right ones for it.
      const int luma =
          std::clamp(static_cast<int>(0.2126f * r + 0.7152f * g + 0.0722f * b + 0.5f), 0, 255);
      analysis.histogram[static_cast<std::size_t>(luma)] += 1;
      sums[0] += r;
      sums[1] += g;
      sums[2] += b;
      chroma += std::max({r, g, b}) - std::min({r, g, b});

      // Compared against the pixel to the right and the one below, so a
      // gradient in either direction is seen. Edges of the frame have one
      // neighbour fewer, which is why the count is accumulated rather than
      // assumed.
      if (x + 1 < width) {
        detail += std::abs(luma - static_cast<int>(0.2126f * row[index + kChannels + 0] +
                                                   0.7152f * row[index + kChannels + 1] +
                                                   0.0722f * row[index + kChannels + 2] + 0.5f));
        neighbours += 1;
      }
      if (below != nullptr) {
        detail += std::abs(luma - static_cast<int>(0.2126f * below[index + 0] +
                                                   0.7152f * below[index + 1] +
                                                   0.0722f * below[index + 2] + 0.5f));
        neighbours += 1;
      }
    }
  }

  analysis.pixels = static_cast<std::uint64_t>(width) * height;
  const double count = static_cast<double>(analysis.pixels);
  for (int c = 0; c < 3; ++c) {
    analysis.channel_mean[c] = static_cast<float>(sums[c] / count / 255.0);
  }
  analysis.chroma_mean = static_cast<float>(chroma / count / 255.0);
  analysis.detail =
      neighbours == 0 ? 0.0f : static_cast<float>(detail / static_cast<double>(neighbours) / 255.0);
  return analysis;
}

}  // namespace photoy
