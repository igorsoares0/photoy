#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "edit/adjustments.h"
#include "edit/layer.h"
#include "image/orientation.h"
#include "image/rect.h"

namespace photoy {

enum class OperationKind {
  kRotate,
  kFlipHorizontal,
  kFlipVertical,
  kCrop,
  kAdjust,
  kAddLayer,
  kRemoveLayer,
  kReorderLayer,
  kSetLayerVisible,
  kSetLayerOpacity,
  kSetLayerBlend,
  kSetLayerMask,
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

  /// Layer this operation acts on. Zero means the topmost adjustment layer,
  /// which is what lets a document with nothing but adjustments behave as if
  /// layers were not there yet.
  std::uint64_t target_layer = 0;
  /// kReorderLayer: position among the adjustment layers, counting from the
  /// bottom. kSetLayerVisible / kSetLayerOpacity / kSetLayerBlend use the
  /// fields below.
  int index = 0;
  bool flag = true;
  float amount = 1.0f;
  BlendMode blend = BlendMode::kNormal;
  /// kAddLayer: the name shown in the panel.
  std::string name;
  /// kSetLayerMask: where the layer applies.
  Mask mask;

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

/// The adjustment state in effect on the topmost adjustment layer.
Adjustments FoldAdjustments(const std::vector<Operation>& operations) noexcept;

/**
 * Replays the operations into the layer stack they describe, bottom first.
 *
 * Identifiers are assigned during the replay rather than stored, so the same
 * operation list always produces the same stack. That is what will let a
 * project file be the list itself, with nothing to keep in sync.
 */
std::vector<Layer> FoldLayers(const std::vector<Operation>& operations);

}  // namespace photoy
