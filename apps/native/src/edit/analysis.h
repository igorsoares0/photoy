#pragma once

#include <array>
#include <cstdint>

#include "image/image_buffer.h"

namespace photoy {

/// Bins in the luminance histogram: one per level of the encoded output.
inline constexpr int kHistogramBins = 256;

/**
 * What can be measured about a photograph, as opposed to decided about it.
 *
 * The split is deliberate. Measuring is arithmetic and belongs here; deciding
 * what a measurement is worth - that a picture is too flat, that a cast wants
 * correcting - is taste, and taste lives in the renderer where it can be
 * changed without a rebuild and read without a compiler.
 *
 * Everything is measured on the encoded output rather than on linear light,
 * because these are judgements about how a picture looks and that is the space
 * looking happens in.
 */
struct Analysis {
  /// Distribution of luminance, 0 to 255.
  std::array<std::uint32_t, kHistogramBins> histogram{};
  /// Pixels counted, which is what turns the bins into fractions.
  std::uint64_t pixels = 0;

  /// Mean of each channel, 0 to 1. Their spread is what a colour cast is.
  float channel_mean[3] = {0.0f, 0.0f, 0.0f};
  /// Mean distance from grey, 0 to 1.
  float chroma_mean = 0.0f;
  /**
   * Mean absolute difference between neighbouring pixels, 0 to 1.
   *
   * A stand-in for how much fine detail there is: a soft or slightly out of
   * focus picture has little, a crisp one has more. It says nothing about
   * whether that detail is wanted.
   */
  float detail = 0.0f;
};

/// Measures an already-encoded frame. Cheap enough to run on a small preview.
Analysis Analyse(const Image8& encoded) noexcept;

}  // namespace photoy
