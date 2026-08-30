#include "color/matrix.h"

#include <cmath>
#include <string>

#include "core/error.h"

namespace photoy::color {
namespace {

/// XYZ of a chromaticity, normalised so that Y is 1.
void ToXyz(const Chromaticity& c, double* x, double* y, double* z) {
  *x = c.x / c.y;
  *y = 1.0;
  *z = (1.0 - c.x - c.y) / c.y;
}

/// The Bradford cone response matrix, and its inverse.
const Mat3 kBradford{{0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296}};

}  // namespace

Mat3 Multiply(const Mat3& a, const Mat3& b) noexcept {
  Mat3 result;
  for (int row = 0; row < 3; ++row) {
    for (int column = 0; column < 3; ++column) {
      double sum = 0.0;
      for (int k = 0; k < 3; ++k) sum += a.At(row, k) * b.At(k, column);
      result.At(row, column) = sum;
    }
  }
  return result;
}

Mat3 Invert(const Mat3& matrix) {
  const double a = matrix.At(0, 0);
  const double b = matrix.At(0, 1);
  const double c = matrix.At(0, 2);
  const double d = matrix.At(1, 0);
  const double e = matrix.At(1, 1);
  const double f = matrix.At(1, 2);
  const double g = matrix.At(2, 0);
  const double h = matrix.At(2, 1);
  const double i = matrix.At(2, 2);

  const double determinant =
      a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (std::abs(determinant) < 1e-12) {
    throw EngineException(error_code::kInternalError, "Singular colour matrix",
                          "determinant " + std::to_string(determinant));
  }
  const double inv = 1.0 / determinant;

  Mat3 result;
  result.At(0, 0) = (e * i - f * h) * inv;
  result.At(0, 1) = (c * h - b * i) * inv;
  result.At(0, 2) = (b * f - c * e) * inv;
  result.At(1, 0) = (f * g - d * i) * inv;
  result.At(1, 1) = (a * i - c * g) * inv;
  result.At(1, 2) = (c * d - a * f) * inv;
  result.At(2, 0) = (d * h - e * g) * inv;
  result.At(2, 1) = (b * g - a * h) * inv;
  result.At(2, 2) = (a * e - b * d) * inv;
  return result;
}

Mat3 RgbToXyz(const ColorSpaceDefinition& space) {
  double xr = 0;
  double yr = 0;
  double zr = 0;
  double xg = 0;
  double yg = 0;
  double zg = 0;
  double xb = 0;
  double yb = 0;
  double zb = 0;
  ToXyz(space.red, &xr, &yr, &zr);
  ToXyz(space.green, &xg, &yg, &zg);
  ToXyz(space.blue, &xb, &yb, &zb);

  const Mat3 primaries{{xr, xg, xb, yr, yg, yb, zr, zg, zb}};

  double xw = 0;
  double yw = 0;
  double zw = 0;
  ToXyz(space.white, &xw, &yw, &zw);

  // Scale each primary so that RGB(1,1,1) lands exactly on the white point.
  const Mat3 inverse = Invert(primaries);
  const double sr = inverse.At(0, 0) * xw + inverse.At(0, 1) * yw + inverse.At(0, 2) * zw;
  const double sg = inverse.At(1, 0) * xw + inverse.At(1, 1) * yw + inverse.At(1, 2) * zw;
  const double sb = inverse.At(2, 0) * xw + inverse.At(2, 1) * yw + inverse.At(2, 2) * zw;

  return Mat3{{xr * sr, xg * sg, xb * sb, yr * sr, yg * sg, yb * sb, zr * sr, zg * sg, zb * sb}};
}

Mat3 Adapt(const Chromaticity& from, const Chromaticity& to) {
  double xs = 0;
  double ys = 0;
  double zs = 0;
  double xd = 0;
  double yd = 0;
  double zd = 0;
  ToXyz(from, &xs, &ys, &zs);
  ToXyz(to, &xd, &yd, &zd);

  const auto cone = [](const Mat3& m, double x, double y, double z, int row) {
    return m.At(row, 0) * x + m.At(row, 1) * y + m.At(row, 2) * z;
  };

  Mat3 scale;
  for (int row = 0; row < 3; ++row) {
    const double source = cone(kBradford, xs, ys, zs, row);
    const double target = cone(kBradford, xd, yd, zd, row);
    scale.At(row, row) = target / source;
    for (int column = 0; column < 3; ++column) {
      if (column != row) scale.At(row, column) = 0.0;
    }
  }
  return Multiply(Invert(kBradford), Multiply(scale, kBradford));
}

Mat3 WorkingToLinear(const ColorSpaceDefinition& target) {
  const Mat3 working_to_xyz = RgbToXyz(kWorkingSpace);
  const Mat3 adaptation = Adapt(kWorkingSpace.white, target.white);
  const Mat3 xyz_to_target = Invert(RgbToXyz(target));
  return Multiply(xyz_to_target, Multiply(adaptation, working_to_xyz));
}

}  // namespace photoy::color
