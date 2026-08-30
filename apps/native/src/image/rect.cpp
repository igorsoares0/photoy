#include "image/rect.h"

#include <algorithm>

namespace photoy {

Rect Intersect(const Rect& a, const Rect& b) noexcept {
  const int left = std::max(a.x, b.x);
  const int top = std::max(a.y, b.y);
  const int right = std::min(a.right(), b.right());
  const int bottom = std::min(a.bottom(), b.bottom());
  if (right <= left || bottom <= top) return {};
  return {left, top, right - left, bottom - top};
}

}  // namespace photoy
