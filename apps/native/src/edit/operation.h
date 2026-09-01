#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "edit/adjustments.h"
#include "decoder/decoder.h"
#include "edit/layer.h"
#include "image/orientation.h"
#include "image/rect.h"

namespace photoy {

enum class OperationKind {
  kRotate,
  kFlipHorizontal,
  kFlipVertical,
  kCrop,
  kResize,
  kAdjust,
  kAddLayer,
  kRemoveLayer,
  kReorderLayer,
  kSetLayerVisible,
  kSetLayerOpacity,
  kSetLayerBlend,
  kSetLayerMask,
  kSetLayerFill,
  kSetLayerDecontaminate,
  kSetLayerPatch,
  kDevelopRaw,
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
  /// kAddLayer: the name shown in the panel, and what kind to create.
  std::string name;
  LayerKind layer_kind = LayerKind::kAdjustment;
  /// kSetLayerFill: what replaces the part a matte removes.
  FillKind fill = FillKind::kTransparent;
  FillColor color;
  /// kSetLayerDecontaminate also travels in `amount`.
  /// kSetLayerMask: where the layer applies.
  Mask mask;
  /// kResize: the size the document should have from here on.
  /// kSetLayerPatch also uses these, for the size the patch was made against.
  int target_width = 0;
  int target_height = 0;
  /// kSetLayerPatch: which stored patch the layer draws.
  std::uint64_t patch = 0;
  /// kDevelopRaw: how the file should be decoded, rather than what to do with
  /// the pixels afterwards. The whole state, like adjustments, so the entry in
  /// effect is simply the last one.
  RawSettings raw;

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
  /**
   * Size a resize asked for, in output coordinates. Zero means the natural one.
   *
   * Kept separate from `source_rect` because the rect says which pixels survive
   * and this says how many pixels they become - two questions that a crop and a
   * resize answer independently, and that have to stay independent for the
   * stack to replay in any order.
   */
  int target_width = 0;
  int target_height = 0;

  /// Size of the crop under the orientation, before any resize.
  int NaturalWidth() const noexcept;
  int NaturalHeight() const noexcept;
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
 * The raw development settings in effect.
 *
 * Folded separately from everything else because it decides what the decoder
 * produces, not what happens to what it produced: a change here means the
 * source pixels themselves are different, and the geometry and layer folds both
 * run on top of whatever comes out.
 */
RawSettings FoldRawSettings(const std::vector<Operation>& operations) noexcept;

/**
 * Replays the operations into the layer stack they describe, bottom first.
 *
 * Identifiers are assigned during the replay rather than stored, so the same
 * operation list always produces the same stack. That is what will let a
 * project file be the list itself, with nothing to keep in sync.
 */
std::vector<Layer> FoldLayers(const std::vector<Operation>& operations);

}  // namespace photoy
