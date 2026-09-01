#include "color/temperature.h"

#include <algorithm>
#include <cmath>

namespace photoy::color {
namespace {

/**
 * Tint units per unit of displacement in CIE 1960 UCS.
 *
 * Arbitrary, in the sense that tint has no physical unit - it is a slider. The
 * value is chosen so the range this file allows covers a strong fluorescent
 * cast in one direction and a strong foliage cast in the other, which is the
 * span the control has to be able to correct.
 */
constexpr double kTintScale = 3000.0;

/// Kelvin apart used to take the locus tangent by difference. Small enough to
/// be a tangent, large enough not to be swallowed by the cubic's own noise.
constexpr double kTangentStep = 1.0;

/**
 * Kim et al.'s cubic fit to the Planckian locus, valid from 1667 K to 25000 K.
 *
 * A fit rather than the Robertson table because the table is thirty-one rows of
 * constants that say nothing about what they are, and this says exactly what it
 * is. Checked against a standard: at 2856 K it gives (0.4471, 0.4075), and CIE
 * illuminant A is defined at that temperature as (0.44757, 0.40745).
 *
 * The fit is piecewise, and the pieces do not meet perfectly. Measured at the
 * 4000 K seam the chromaticity steps by 0.0001, four times what a single kelvin
 * moves it elsewhere and still far below anything an eye resolves, so dragging
 * a slider through the seam shows nothing.
 */
Chromaticity PlanckianXy(double kelvin) {
  const double t = std::clamp(kelvin, 1667.0, 25000.0);
  const double inverse = 1.0e3 / t;
  const double inverse2 = inverse * inverse;
  const double inverse3 = inverse2 * inverse;

  const double x = t <= 4000.0
                       ? -0.2661239 * inverse3 - 0.2343589 * inverse2 + 0.8776956 * inverse +
                             0.179910
                       : -3.0258469 * inverse3 + 2.1070379 * inverse2 + 0.2226347 * inverse +
                             0.240390;

  const double x2 = x * x;
  const double x3 = x2 * x;
  double y = 0.0;
  if (t <= 2222.0) {
    y = -1.1063814 * x3 - 1.34811020 * x2 + 2.18555832 * x - 0.20219683;
  } else if (t <= 4000.0) {
    y = -0.9549476 * x3 - 1.37418593 * x2 + 2.09137015 * x - 0.16748867;
  } else {
    y = 3.0817580 * x3 - 5.87338670 * x2 + 3.75112997 * x - 0.37001483;
  }
  return {x, y};
}

/**
 * CIE 1960 UCS.
 *
 * Tint is a displacement here rather than in xy because in this space the
 * isotherms meet the locus at right angles, so "off the locus by this much"
 * means the same thing at 3000 K as at 9000 K. In xy it would not.
 */
struct Uv {
  double u = 0.0;
  double v = 0.0;
};

Uv ToUv(const Chromaticity& xy) {
  const double denominator = -2.0 * xy.x + 12.0 * xy.y + 3.0;
  if (std::abs(denominator) < 1.0e-9) return {};
  return {4.0 * xy.x / denominator, 6.0 * xy.y / denominator};
}

Chromaticity FromUv(const Uv& uv) {
  const double denominator = 2.0 * uv.u - 8.0 * uv.v + 4.0;
  if (std::abs(denominator) < 1.0e-9) return {};
  return {3.0 * uv.u / denominator, 2.0 * uv.v / denominator};
}

/**
 * Unit normal to the locus at `kelvin`, pointing to the green side.
 *
 * Green, not magenta, because tint is stated as its effect on the photograph
 * and the illuminant has to move the other way: correcting a green cast means
 * balancing to a greener light. The direction is asserted by a test rather than
 * argued here.
 */
Uv LocusNormal(double kelvin) {
  const Uv before = ToUv(PlanckianXy(kelvin - kTangentStep));
  const Uv after = ToUv(PlanckianXy(kelvin + kTangentStep));
  const double du = after.u - before.u;
  const double dv = after.v - before.v;
  const double length = std::hypot(du, dv);
  if (length < 1.0e-12) return {0.0, 1.0};
  // Rotating the tangent a quarter turn gives the normal, and negating chooses
  // which of the two sides it points at.
  return {dv / length, -du / length};
}

double Mired(double kelvin) { return 1.0e6 / kelvin; }
double Kelvin(double mired) { return 1.0e6 / mired; }

/// Squared distance in UCS from `point` to the locus at `kelvin`.
double DistanceTo(double kelvin, const Uv& point) {
  const Uv on = ToUv(PlanckianXy(kelvin));
  const double du = point.u - on.u;
  const double dv = point.v - on.v;
  return du * du + dv * dv;
}

}  // namespace

Chromaticity ChromaticityFor(const WhiteBalance& balance) {
  const double kelvin = std::clamp(balance.kelvin, kMinKelvin, kMaxKelvin);
  const double tint = std::clamp(balance.tint, -kMaxTint, kMaxTint);

  const Uv on = ToUv(PlanckianXy(kelvin));
  const Uv normal = LocusNormal(kelvin);
  const double offset = tint / kTintScale;
  return FromUv({on.u + normal.u * offset, on.v + normal.v * offset});
}

WhiteBalance BalanceFor(const Chromaticity& white) {
  const Uv point = ToUv(white);

  // Searched in mireds rather than kelvin: the locus is close to straight in
  // reciprocal temperature, which keeps the distance unimodal and lets a plain
  // ternary search find the foot of the perpendicular without a table.
  double low = Mired(kMaxKelvin);
  double high = Mired(kMinKelvin);
  for (int step = 0; step < 80; ++step) {
    const double third = (high - low) / 3.0;
    const double a = low + third;
    const double b = high - third;
    if (DistanceTo(Kelvin(a), point) < DistanceTo(Kelvin(b), point)) {
      high = b;
    } else {
      low = a;
    }
  }

  const double kelvin = Kelvin((low + high) / 2.0);
  const Uv on = ToUv(PlanckianXy(kelvin));
  const Uv normal = LocusNormal(kelvin);
  const double tint = ((point.u - on.u) * normal.u + (point.v - on.v) * normal.v) * kTintScale;
  return {std::clamp(kelvin, kMinKelvin, kMaxKelvin), std::clamp(tint, -kMaxTint, kMaxTint)};
}

Multipliers MultipliersFor(const Mat3& camera_from_xyz, const WhiteBalance& balance) {
  const Chromaticity white = ChromaticityFor(balance);
  if (white.y < 1.0e-9) return {};

  // The illuminant at unit luminance, which is all the multipliers care about:
  // a scale factor on the illuminant cancels in the normalisation below.
  const double xyz[3] = {white.x / white.y, 1.0, (1.0 - white.x - white.y) / white.y};

  double camera[3] = {0.0, 0.0, 0.0};
  for (int row = 0; row < 3; ++row) {
    for (int column = 0; column < 3; ++column) {
      camera[row] += camera_from_xyz.At(row, column) * xyz[column];
    }
  }

  // A camera that records nothing in a channel for this illuminant would want
  // an infinite multiplier. It does not happen for a real matrix and a real
  // illuminant, but a corrupt matrix is not worth an infinity downstream.
  constexpr double kFloor = 1.0e-6;
  for (double& value : camera) value = std::max(value, kFloor);

  return {camera[1] / camera[0], 1.0, camera[1] / camera[2]};
}

WhiteBalance BalanceFrom(const Mat3& camera_from_xyz, const Multipliers& multipliers) {
  constexpr double kFloor = 1.0e-6;
  const double r = std::max(multipliers.r, kFloor);
  const double g = std::max(multipliers.g, kFloor);
  const double b = std::max(multipliers.b, kFloor);

  // Multipliers are the reciprocal of what the camera records for the white it
  // was balanced to, so inverting them recovers that camera response.
  const double camera[3] = {1.0 / r, 1.0 / g, 1.0 / b};

  const Mat3 xyz_from_camera = Invert(camera_from_xyz);
  double xyz[3] = {0.0, 0.0, 0.0};
  for (int row = 0; row < 3; ++row) {
    for (int column = 0; column < 3; ++column) {
      xyz[row] += xyz_from_camera.At(row, column) * camera[column];
    }
  }

  const double sum = xyz[0] + xyz[1] + xyz[2];
  if (std::abs(sum) < 1.0e-9) return {};
  return BalanceFor({xyz[0] / sum, xyz[1] / sum});
}

}  // namespace photoy::color
