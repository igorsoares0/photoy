#pragma once

#include <memory>
#include <vector>

#include "edit/mask.h"
#include "image/image_buffer.h"

namespace photoy {

/**
 * A smooth estimate of what colour lies behind the subject.
 *
 * Cutting a subject out along a soft edge leaves pixels that are a mixture of
 * the subject and whatever was behind it. Compositing that mixture onto a new
 * background keeps the old one's colour in it, which is the pale rim you see
 * around hair on a cut-out. Undoing the mixture needs to know what the old
 * background was, and that is what this holds.
 *
 * It is deliberately coarse. The background near an edge varies slowly - it is
 * a wall, a sky, a blurred street - so a grid a couple of hundred cells across
 * carries it, costs one pass over the image to build, and cannot introduce
 * detail of its own into the result.
 */
struct BackgroundEstimate {
  int width = 0;
  int height = 0;
  /// Image pixels to grid cells.
  float scale_x = 1.0f;
  float scale_y = 1.0f;
  /// Three floats per cell, in the working space.
  std::vector<float> rgb;

  bool empty() const noexcept { return width <= 0 || height <= 0; }
  /// Bilinear, in image coordinates.
  void SampleAt(int x, int y, float out[3]) const noexcept;
};

using BackgroundEstimatePtr = std::shared_ptr<const BackgroundEstimate>;

/**
 * Builds the estimate from the pixels the mask calls background.
 *
 * Cells with no background under them at all - the middle of the subject - are
 * filled by spreading their neighbours inward, so every edge pixel has a value
 * to unmix against even when it sits deep inside a hairline.
 */
/**
 * `grid_long_side` is how many cells the estimate spans, and `smoothing` is the
 * box radius, in cells, it is blurred by afterwards.
 *
 * Unmixing an edge wants the coarsest, smoothest thing that can still be called
 * the background. Replacing a background with a blurred version of itself wants
 * the same construction at a finer grid and a chosen radius, which is why this
 * takes the two as parameters rather than owning an opinion about them.
 */
BackgroundEstimatePtr EstimateBackground(const Image16& image, const CompiledMask& mask,
                                         int grid_long_side = 192, int smoothing = 1);

}  // namespace photoy
