#pragma once

#include "color/matrix.h"
#include "color/primaries.h"

namespace photoy::color {

/**
 * A white point the way a photographer adjusts one.
 *
 * Not a chromaticity, because nobody thinks in chromaticities. Temperature
 * moves along the Planckian locus - the colours a black body glows at as it
 * heats - and tint moves off it, which is the axis a fluorescent tube or
 * foliage bounce pushes an image along and no temperature can answer.
 */
struct WhiteBalance {
  double kelvin = 6500.0;
  /**
   * Displacement off the locus, stated as its effect on the photograph:
   * negative is green, positive is magenta, which is the direction every other
   * raw converter's slider moves.
   *
   * That is the opposite of its effect on the illuminant, and deliberately so.
   * Balancing to a greener light means correcting towards magenta, so a slider
   * labelled by what the light was would move the picture the other way and
   * read backwards to everyone who has used one before.
   */
  double tint = 0.0;
};

/// Range the sliders and the inverse search honour. The lower bound is warmer
/// than candlelight and the upper is bluer than any sky, so clamping here never
/// takes away a white point a photograph could plausibly need.
inline constexpr double kMinKelvin = 2000.0;
inline constexpr double kMaxKelvin = 25000.0;
inline constexpr double kMaxTint = 150.0;

/// Chromaticity of the illuminant a temperature and tint describe.
Chromaticity ChromaticityFor(const WhiteBalance& balance);

/// The temperature and tint whose illuminant sits closest to `white`.
WhiteBalance BalanceFor(const Chromaticity& white);

/// Per-channel white-balance multipliers, normalised so green is 1.
struct Multipliers {
  double r = 1.0;
  double g = 1.0;
  double b = 1.0;
};

/**
 * Multipliers that make `balance` come out neutral.
 *
 * `camera_from_xyz` is the camera's response to CIE XYZ, which every raw file
 * carries in one form or another. Scaling each channel by the reciprocal of
 * what the camera records for an illuminant is what "white balancing to" that
 * illuminant means.
 */
Multipliers MultipliersFor(const Mat3& camera_from_xyz, const WhiteBalance& balance);

/// The inverse: which temperature and tint a camera's own multipliers describe.
WhiteBalance BalanceFrom(const Mat3& camera_from_xyz, const Multipliers& multipliers);

}  // namespace photoy::color
