#pragma once

#include "image/image_buffer.h"
#include "jobs/cancellation.h"

namespace photoy {

/// EXIF tag 0x0112. Value 1 means the pixels are already upright.
enum class Orientation : int {
  kTopLeft = 1,
  kTopRight = 2,
  kBottomRight = 3,
  kBottomLeft = 4,
  kLeftTop = 5,
  kRightTop = 6,
  kRightBottom = 7,
  kLeftBottom = 8,
};

/// Clamps an arbitrary integer to a valid orientation, defaulting to upright.
Orientation OrientationFromInt(int value) noexcept;

/// True when applying the orientation swaps width and height.
bool SwapsAxes(Orientation orientation) noexcept;

/**
 * The eight orientations form the symmetry group of a rectangle, which is why
 * any run of rotations and flips collapses to a single one of them.
 *
 * That is what keeps the edit stack cheap: a document rotated four times and
 * flipped twice costs exactly one pass over the pixels, not six.
 */

/// The orientation that undoes `orientation`.
Orientation Inverse(Orientation orientation) noexcept;

/// The orientation equivalent to applying `first`, then `second`.
Orientation Compose(Orientation second, Orientation first) noexcept;

/// Quarter-turn clockwise, as an orientation.
Orientation RotateQuarters(int quarters) noexcept;

/// Mirror across the vertical axis, swapping left and right.
Orientation FlipHorizontal() noexcept;

/// Mirror across the horizontal axis, swapping top and bottom.
Orientation FlipVertical() noexcept;

/// Where a source pixel lands once the orientation is applied.
void MapPoint(Orientation orientation, int source_width, int source_height, int x, int y,
              int* out_x, int* out_y) noexcept;

/**
 * Rewrites `image` so the pixels are upright, undoing the flip and rotation the
 * capture device recorded. Decoding is the only place this happens: everything
 * downstream, including export, works on upright pixels.
 */
Image16 ApplyOrientation(const Image16& image, Orientation orientation,
                         const CancellationTokenPtr& token = NeverCancelled());

}  // namespace photoy
