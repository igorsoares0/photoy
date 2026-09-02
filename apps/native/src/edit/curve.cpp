#include "edit/curve.h"

#include <algorithm>
#include <cmath>

namespace photoy {
namespace {

/// How far from y = x a point may sit and still count as being on it. One
/// thousandth of the range, which is a quarter of a level in 8-bit output.
constexpr float kIdentityTolerance = 1.0e-3f;

bool IsFinite(const CurvePoint& point) noexcept {
  return std::isfinite(point.x) && std::isfinite(point.y);
}

}  // namespace

Curve Sanitise(const Curve& curve) {
  Curve result;
  result.points.reserve(curve.points.size() + 2);

  for (const CurvePoint& point : curve.points) {
    if (!IsFinite(point)) continue;
    result.points.push_back({std::clamp(point.x, 0.0f, 1.0f), std::clamp(point.y, 0.0f, 1.0f)});
  }

  // Stable, so two points that arrive at the same x keep the order they were
  // given in and the thinning below drops the later one.
  std::stable_sort(result.points.begin(), result.points.end(),
                   [](const CurvePoint& a, const CurvePoint& b) { return a.x < b.x; });

  std::vector<CurvePoint> thinned;
  thinned.reserve(result.points.size());
  for (const CurvePoint& point : result.points) {
    if (!thinned.empty() && point.x - thinned.back().x < kMinCurveSpacing) continue;
    thinned.push_back(point);
    if (static_cast<int>(thinned.size()) == kMaxCurvePoints - 2) break;
  }
  result.points = std::move(thinned);

  if (result.points.empty()) return result;
  // The ends are filled in with the identity rather than with a copy of the
  // nearest point: an untouched end should stay untouched, not be flattened to
  // whatever the first point someone dragged happens to say.
  if (result.points.front().x > 0.0f) result.points.insert(result.points.begin(), {0.0f, 0.0f});
  if (result.points.back().x < 1.0f) result.points.push_back({1.0f, 1.0f});
  return result;
}

bool IsIdentity(const Curve& curve) noexcept {
  for (const CurvePoint& point : curve.points) {
    if (!IsFinite(point)) continue;
    if (std::abs(point.y - point.x) > kIdentityTolerance) return false;
  }
  // Every point sits on y = x, and a monotone cubic through points that are all
  // on a straight line is that line, so the curve returns what it was given.
  return true;
}

CurveSpline::CurveSpline(const Curve& curve) {
  const Curve clean = Sanitise(curve);
  identity_ = IsIdentity(clean);
  if (identity_ || clean.points.size() < 2) return;

  points_ = clean.points;
  const std::size_t count = points_.size();

  std::vector<float> secants(count - 1);
  for (std::size_t i = 0; i + 1 < count; ++i) {
    secants[i] = (points_[i + 1].y - points_[i].y) / (points_[i + 1].x - points_[i].x);
  }

  tangents_.resize(count);
  tangents_.front() = secants.front();
  tangents_.back() = secants.back();
  for (std::size_t i = 1; i + 1 < count; ++i) {
    tangents_[i] = 0.5f * (secants[i - 1] + secants[i]);
  }

  // The Fritsch-Carlson limiter. A flat segment pins both of its tangents to
  // zero, and anywhere else the pair is pulled back inside the circle of radius
  // three, which is the condition for the cubic not to turn back on itself.
  for (std::size_t i = 0; i + 1 < count; ++i) {
    if (secants[i] == 0.0f) {
      tangents_[i] = 0.0f;
      tangents_[i + 1] = 0.0f;
      continue;
    }
    const float alpha = tangents_[i] / secants[i];
    const float beta = tangents_[i + 1] / secants[i];
    const float squared = alpha * alpha + beta * beta;
    if (squared > 9.0f) {
      const float scale = 3.0f / std::sqrt(squared);
      tangents_[i] = scale * alpha * secants[i];
      tangents_[i + 1] = scale * beta * secants[i];
    }
  }
}

float CurveSpline::At(float x) const noexcept {
  if (identity_ || points_.size() < 2) return std::clamp(x, 0.0f, 1.0f);
  const float clamped = std::clamp(x, 0.0f, 1.0f);

  // Sixteen points at most, so a scan finds the segment faster than a search
  // would and without the branch that gets it wrong at the ends.
  std::size_t segment = 0;
  while (segment + 2 < points_.size() && clamped > points_[segment + 1].x) ++segment;

  const CurvePoint& low = points_[segment];
  const CurvePoint& high = points_[segment + 1];
  const float span = high.x - low.x;
  const float t = (clamped - low.x) / span;
  const float t2 = t * t;
  const float t3 = t2 * t;

  // Cubic Hermite, written out rather than folded, because the four basis
  // functions are what the limiter above was reasoning about.
  const float h00 = 2.0f * t3 - 3.0f * t2 + 1.0f;
  const float h10 = t3 - 2.0f * t2 + t;
  const float h01 = -2.0f * t3 + 3.0f * t2;
  const float h11 = t3 - t2;

  const float y = h00 * low.y + h10 * span * tangents_[segment] + h01 * high.y +
                  h11 * span * tangents_[segment + 1];
  return std::clamp(y, 0.0f, 1.0f);
}

}  // namespace photoy
