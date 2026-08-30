#pragma once

namespace photoy::color {

/// A chromaticity in CIE xy.
struct Chromaticity {
  double x = 0.0;
  double y = 0.0;
};

/// How a space encodes linear light for storage.
enum class TransferFunction {
  kLinear,
  /// The piecewise curve sRGB and Display P3 share.
  kSrgb,
  /// A pure power curve, as Adobe RGB uses.
  kPower,
};

/**
 * Everything that defines an RGB colour space.
 *
 * One definition serves both consumers: profile.cpp builds ICC profiles from
 * it, and matrix.cpp derives conversion matrices from it. Anywhere else would
 * be a second place for the working space to be defined, and they would drift.
 */
struct ColorSpaceDefinition {
  Chromaticity red;
  Chromaticity green;
  Chromaticity blue;
  Chromaticity white;
  TransferFunction transfer = TransferFunction::kSrgb;
  /// Exponent for kPower. Ignored otherwise.
  double gamma = 1.0;
};

inline constexpr Chromaticity kD50{0.34567, 0.35850};
inline constexpr Chromaticity kD65{0.31270, 0.32900};

/**
 * The engine's working space: linear light on ProPhoto (ROMM) primaries.
 *
 * Wide enough to hold any camera gamut without clipping on the way in, and
 * linear so that exposure is a multiply and a resample averages light rather
 * than gamma-encoded numbers.
 */
inline constexpr ColorSpaceDefinition kWorkingSpace{
    {0.734699, 0.265301}, {0.159597, 0.840403}, {0.036598, 0.000105},
    kD50,                 TransferFunction::kLinear};

inline constexpr ColorSpaceDefinition kSrgbSpace{
    {0.640, 0.330}, {0.300, 0.600}, {0.150, 0.060}, kD65, TransferFunction::kSrgb};

inline constexpr ColorSpaceDefinition kDisplayP3Space{
    {0.680, 0.320}, {0.265, 0.690}, {0.150, 0.060}, kD65, TransferFunction::kSrgb};

/// Adobe RGB (1998) encodes with a power of 563/256.
inline constexpr ColorSpaceDefinition kAdobeRgbSpace{
    {0.640, 0.330}, {0.210, 0.710}, {0.150, 0.060}, kD65, TransferFunction::kPower,
    563.0 / 256.0};

/// Colour spaces the engine can write out.
enum class OutputSpace { kSrgb, kDisplayP3, kAdobeRgb, kCount };

inline const ColorSpaceDefinition& DefinitionFor(OutputSpace space) noexcept {
  switch (space) {
    case OutputSpace::kDisplayP3: return kDisplayP3Space;
    case OutputSpace::kAdobeRgb: return kAdobeRgbSpace;
    default: break;
  }
  return kSrgbSpace;
}

}  // namespace photoy::color
