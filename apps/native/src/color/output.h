#pragma once

#include <cstdint>
#include <vector>

#include "color/matrix.h"
#include "color/primaries.h"
#include "image/image_buffer.h"

namespace photoy::color {

/**
 * Applied to each pixel in working space before the conversion.
 *
 * Receives the pixel's position as well as its colour, because a mask varies
 * across the frame and computing it here costs nothing extra. The default does
 * nothing and compiles away entirely.
 */
struct NoPreProcess {
  void operator()(float&, float&, float&, int, int) const noexcept {}
};

/**
 * Converts working-space pixels into an output space.
 *
 * This is deliberately not lcms. The conversion out of the working space is
 * fixed - the same two endpoints every time - so it reduces to one 3x3 matrix
 * and one transfer curve, and measures about twenty times faster than the
 * general ICC pipeline. lcms is still what reads the arbitrary profile embedded
 * in a file, which is the job it is irreplaceable for; it just does not belong
 * on a path that runs once per frame.
 *
 * The loop takes a caller-supplied step so that adjustments ride along in the
 * same pass. Writing them as a separate pass would double the memory traffic
 * over the largest buffer in the engine, and this module would have to know
 * what an adjustment is.
 */
class OutputConverter {
 public:
  explicit OutputConverter(const ColorSpaceDefinition& target);

  /// Converts `rows` rows starting at `first_row`. Rows are independent, which
  /// is what lets the caller band the work and check for cancellation between.
  template <typename PreProcess = NoPreProcess>
  void ConvertRows(const Image16& source, Image8& target, int first_row, int rows,
                   const PreProcess& pre = PreProcess{}) const {
    Convert(source, target, first_row, rows, pre, 255.0f);
  }

  template <typename PreProcess = NoPreProcess>
  void ConvertRows(const Image16& source, Image16& target, int first_row, int rows,
                   const PreProcess& pre = PreProcess{}) const {
    Convert(source, target, first_row, rows, pre, 65535.0f);
  }

 private:
  /// Encoded output value for a linear input, interpolated within the table.
  float Encode(float linear) const noexcept {
    if (linear <= 0.0f) return curve_.front();
    if (linear >= 1.0f) return curve_.back();
    const float position = linear * (kCurveSize - 1);
    const int index = static_cast<int>(position);
    const float fraction = position - static_cast<float>(index);
    const float low = curve_[static_cast<std::size_t>(index)];
    const float high = curve_[static_cast<std::size_t>(index) + 1];
    return low + (high - low) * fraction;
  }

  template <typename Out, typename PreProcess>
  void Convert(const Image16& source, TImageBuffer<Out>& target, int first_row, int rows,
               const PreProcess& pre, float full_scale) const {
    constexpr float kFromSample = 1.0f / 65535.0f;
    for (int y = first_row; y < first_row + rows; ++y) {
      const std::uint16_t* in = source.Row(y);
      Out* out = target.Row(y);
      for (int x = 0; x < source.width(); ++x) {
        const std::size_t index = static_cast<std::size_t>(x) * kChannels;
        float r = in[index + 0] * kFromSample;
        float g = in[index + 1] * kFromSample;
        float b = in[index + 2] * kFromSample;

        pre(r, g, b, x, y);

        const float lr = matrix_[0] * r + matrix_[1] * g + matrix_[2] * b;
        const float lg = matrix_[3] * r + matrix_[4] * g + matrix_[5] * b;
        const float lb = matrix_[6] * r + matrix_[7] * g + matrix_[8] * b;

        out[index + 0] = Quantise<Out>(Encode(lr), full_scale);
        out[index + 1] = Quantise<Out>(Encode(lg), full_scale);
        out[index + 2] = Quantise<Out>(Encode(lb), full_scale);
        // 65535 narrows to 255 exactly, and every other value rounds to nearest.
        out[index + 3] = static_cast<Out>(
            sizeof(Out) == 1 ? ((in[index + 3] * 255u + 32895u) >> 16) : in[index + 3]);
      }
    }
  }

  template <typename Out>
  static Out Quantise(float encoded, float full_scale) noexcept {
    const float scaled = encoded * full_scale + 0.5f;
    return static_cast<Out>(scaled <= 0.0f ? 0.0f : (scaled >= full_scale ? full_scale : scaled));
  }

  static constexpr int kCurveSize = 4096;

  float matrix_[9] = {};
  std::vector<float> curve_;
};

/// Shared converter for a space, built once and reused.
const OutputConverter& ConverterFor(OutputSpace space);

}  // namespace photoy::color
