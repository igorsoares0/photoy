#pragma once

namespace photoy {

/// A rectangle in pixel coordinates, half-open on the right and bottom.
struct Rect {
  int x = 0;
  int y = 0;
  int width = 0;
  int height = 0;

  bool empty() const noexcept { return width <= 0 || height <= 0; }
  int right() const noexcept { return x + width; }
  int bottom() const noexcept { return y + height; }
};

/// The largest rectangle contained in both, or an empty one when they miss.
Rect Intersect(const Rect& a, const Rect& b) noexcept;

}  // namespace photoy
