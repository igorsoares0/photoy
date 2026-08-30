#pragma once

#include "color/primaries.h"

namespace photoy::color {

/// A 3x3 matrix in row-major order.
struct Mat3 {
  double m[9] = {1, 0, 0, 0, 1, 0, 0, 0, 1};

  double At(int row, int column) const noexcept { return m[row * 3 + column]; }
  double& At(int row, int column) noexcept { return m[row * 3 + column]; }
};

Mat3 Multiply(const Mat3& a, const Mat3& b) noexcept;
Mat3 Invert(const Mat3& matrix);

/// Matrix taking linear RGB in this space to CIE XYZ under its own white point.
Mat3 RgbToXyz(const ColorSpaceDefinition& space);

/**
 * Bradford chromatic adaptation between two white points.
 *
 * Needed because the working space is defined on D50 and every output space
 * here is on D65: without it, a conversion between them would shift the whole
 * image towards blue.
 */
Mat3 Adapt(const Chromaticity& from, const Chromaticity& to);

/**
 * The single matrix taking linear working-space RGB to linear RGB in `target`.
 *
 * Derived from the primaries rather than written down, so the working space
 * stays defined in exactly one place.
 */
Mat3 WorkingToLinear(const ColorSpaceDefinition& target);

}  // namespace photoy::color
