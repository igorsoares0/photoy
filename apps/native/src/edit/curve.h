#pragma once

#include <vector>

namespace photoy {

/**
 * One control point, in the perceptual domain the curve is drawn in.
 *
 * Both coordinates run 0 to 1, and both mean the same thing they mean on
 * screen: x is the tone that arrives, y is the tone that leaves. The curve is
 * not applied to linear light - a curve drawn against linear values would put
 * almost the whole photograph in the first tenth of its width, which is not
 * something anyone can aim with.
 */
struct CurvePoint {
  float x = 0.0f;
  float y = 0.0f;

  bool operator==(const CurvePoint& other) const noexcept {
    return x == other.x && y == other.y;
  }
};

/**
 * Largest number of control points a curve may carry, ends included.
 *
 * Not a performance limit - sixteen points cost nothing to evaluate. It is the
 * point past which a curve stops being a shape someone drew and starts being a
 * lookup table pasted in from elsewhere, which is a different feature.
 *
 * Two of the sixteen are held back for the ends, so a curve that is given more
 * points than this keeps the first fourteen and still reaches both ends. Giving
 * the ends away to the fifteenth and sixteenth point someone dropped would
 * leave the curve undefined exactly where the highlights are.
 */
inline constexpr int kMaxCurvePoints = 16;

/**
 * Smallest gap between two control points, in x.
 *
 * Two points at the same input tone would be a vertical step, which no
 * interpolation can express and no interface can hit deliberately. Below this
 * the second point is dropped rather than the pair being averaged, so dragging
 * one point over another leaves the one you were dragging.
 */
inline constexpr float kMinCurveSpacing = 1.0f / 255.0f;

/**
 * A tone curve as the points a person placed, and nothing more.
 *
 * Like the rest of the adjustment set this is parameters rather than pixels:
 * the same points always produce the same response, so a curve survives a
 * project file, a preset and an undo without anything being cached.
 */
struct Curve {
  std::vector<CurvePoint> points;

  bool operator==(const Curve& other) const noexcept { return points == other.points; }
  bool operator!=(const Curve& other) const noexcept { return !(*this == other); }
};

/**
 * Puts a curve into the form everything downstream assumes.
 *
 * Points are clamped into the unit square, sorted, thinned to the minimum
 * spacing and capped in number, and the ends are filled in so the curve is
 * defined across the whole range. That last part is what makes the shape
 * predictable: a curve whose points stop at three quarters still has to say
 * what happens to a highlight, and the answer it gives is the same one it gave
 * before the point was added.
 */
Curve Sanitise(const Curve& curve);

/// True when the curve returns every tone unchanged.
bool IsIdentity(const Curve& curve) noexcept;

/**
 * A sanitised curve with its tangents worked out, ready to be sampled.
 *
 * The interpolation is the Fritsch-Carlson monotone cubic. A plain cubic spline
 * through the same points overshoots between them, which on a photograph means
 * a curve drawn to lift the shadows also darkens something just above them -
 * a reversal nobody asked for and nobody can see the cause of. The monotone
 * form gives that up in exchange for never reversing: if the points go up, so
 * does everything between them.
 */
class CurveSpline {
 public:
  CurveSpline() = default;
  explicit CurveSpline(const Curve& curve);

  /// True when sampling would be a waste of time.
  bool identity() const noexcept { return identity_; }

  /// Samples the curve. Input and result are both in 0 to 1.
  float At(float x) const noexcept;

 private:
  std::vector<CurvePoint> points_;
  /// Slope at each point, after the monotonicity limiter.
  std::vector<float> tangents_;
  bool identity_ = true;
};

/**
 * The four curves a photograph can carry.
 *
 * `rgb` is the tonal statement and the other three are the colour grade laid on
 * top of it, which is also the order they are applied in: shaping the tones and
 * then tinting them keeps a lifted, tinted black where it was put, where the
 * other order would have the tonal curve drag the tint around with it.
 */
struct Curves {
  Curve rgb;
  Curve red;
  Curve green;
  Curve blue;

  bool IsNeutral() const noexcept {
    return IsIdentity(rgb) && IsIdentity(red) && IsIdentity(green) && IsIdentity(blue);
  }
  bool operator==(const Curves& other) const noexcept {
    return rgb == other.rgb && red == other.red && green == other.green && blue == other.blue;
  }
};

}  // namespace photoy
