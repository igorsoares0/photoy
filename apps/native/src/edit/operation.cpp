#include "edit/operation.h"

#include <algorithm>

namespace photoy {
namespace {

/**
 * Maps a rectangle from the coordinates an orientation produces back to the
 * coordinates it was applied to.
 *
 * A crop arrives in the space the user is looking at, which is the rotated one.
 * Folding it into a source rectangle therefore means undoing every rotation and
 * flip that came before it.
 */
Rect MapRectBack(const Rect& rect, Orientation orientation, int source_width,
                 int source_height) noexcept {
  if (rect.empty()) return {};

  const Orientation inverse = Inverse(orientation);
  const bool swap = SwapsAxes(orientation);
  const int oriented_width = swap ? source_height : source_width;
  const int oriented_height = swap ? source_width : source_height;

  // Two opposite corners are enough: the mapping is a symmetry of the
  // rectangle, so it takes axis-aligned boxes to axis-aligned boxes.
  int x0 = 0;
  int y0 = 0;
  int x1 = 0;
  int y1 = 0;
  MapPoint(inverse, oriented_width, oriented_height, rect.x, rect.y, &x0, &y0);
  MapPoint(inverse, oriented_width, oriented_height, rect.right() - 1, rect.bottom() - 1, &x1, &y1);

  const int left = std::min(x0, x1);
  const int top = std::min(y0, y1);
  return {left, top, std::abs(x1 - x0) + 1, std::abs(y1 - y0) + 1};
}

}  // namespace

std::string Operation::KindName() const {
  switch (kind) {
    case OperationKind::kRotate: return "rotate";
    case OperationKind::kFlipHorizontal: return "flipHorizontal";
    case OperationKind::kFlipVertical: return "flipVertical";
    case OperationKind::kCrop: return "crop";
    case OperationKind::kAdjust: return "adjust";
  }
  return "unknown";
}

int Geometry::OutputWidth() const noexcept {
  return SwapsAxes(orientation) ? source_rect.height : source_rect.width;
}

int Geometry::OutputHeight() const noexcept {
  return SwapsAxes(orientation) ? source_rect.width : source_rect.height;
}

Geometry FoldGeometry(const std::vector<Operation>& operations, int source_width,
                      int source_height) {
  Geometry geometry;
  geometry.source_rect = {0, 0, source_width, source_height};

  for (const Operation& operation : operations) {
    switch (operation.kind) {
      case OperationKind::kRotate:
        geometry.orientation =
            Compose(RotateQuarters(operation.quarters), geometry.orientation);
        break;
      case OperationKind::kFlipHorizontal:
        geometry.orientation = Compose(FlipHorizontal(), geometry.orientation);
        break;
      case OperationKind::kFlipVertical:
        geometry.orientation = Compose(FlipVertical(), geometry.orientation);
        break;
      case OperationKind::kAdjust:
        break;  // colour only; the shape is untouched
      case OperationKind::kCrop: {
        // The crop is expressed against what the user sees, so it is mapped
        // back through the accumulated orientation and then clipped to what is
        // still left of the original.
        const Rect in_source = MapRectBack(operation.rect, geometry.orientation,
                                           geometry.source_rect.width, geometry.source_rect.height);
        const Rect shifted{in_source.x + geometry.source_rect.x,
                           in_source.y + geometry.source_rect.y, in_source.width,
                           in_source.height};
        geometry.source_rect = Intersect(shifted, geometry.source_rect);
        break;
      }
    }
  }
  return geometry;
}

Adjustments FoldAdjustments(const std::vector<Operation>& operations) noexcept {
  Adjustments result;
  for (const Operation& operation : operations) {
    if (operation.kind == OperationKind::kAdjust) result = operation.adjustments;
  }
  return result;
}

}  // namespace photoy
