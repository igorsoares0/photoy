#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "edit/adjustments.h"
#include "image/orientation.h"
#include "image/rect.h"

namespace photoy {

enum class OperationKind {
  kRotate,
  kFlipHorizontal,
  kFlipVertical,
  kCrop,
  kAdjust,
};

/**
 * One entry in a document's edit stack.
 *
 * Operations carry their parameters and nothing else - no pixels, no cached
 * result. That is what makes the stack cheap to copy for a render, cheap to
 * serialise into a project, and reversible by simply dropping the last entry.
 */
struct Operation {
  OperationKind kind = OperationKind::kRotate;

  /// kRotate: clockwise quarter turns, normalised to 1-3.
  int quarters = 1;

  /// kCrop: the kept region, in the coordinates the preceding operations produce.
  Rect rect;

  /// kAdjust: the complete slider state, not a delta. Carrying the whole set
  /// means the entry in effect is the last one, with nothing to accumulate.
  Adjustments adjustments;

  /// Stable identifier, assigned on apply, so the host can address history entries.
  std::uint64_t id = 0;

  /// Wire name, matching the OperationKind union in packages/types.
  std::string KindName() const;
};

/**
 * The geometry a run of operations adds up to.
 *
 * Every rotation, flip and crop in the stack folds into one source rectangle
 * and one orientation, so rendering reads each pixel once no matter how long
 * the stack is.
 */
struct Geometry {
  /// Region of the original image that survives, in original coordinates.
  Rect source_rect;
  /// Orientation to apply after the crop.
  Orientation orientation = Orientation::kTopLeft;

  /// Size of the rendered result at full resolution.
  int OutputWidth() const noexcept;
  int OutputHeight() const noexcept;
};

/**
 * Folds the operations against an image of the given size.
 *
 * Adjustments are skipped: they change colour, not shape. That is what lets a
 * dragged slider reuse the geometry the previous render already produced.
 */
Geometry FoldGeometry(const std::vector<Operation>& operations, int source_width,
                      int source_height);

/// The adjustment state in effect, which is simply the last one recorded.
Adjustments FoldAdjustments(const std::vector<Operation>& operations) noexcept;

}  // namespace photoy
