#pragma once

#include <vector>

#include "color/primaries.h"
#include "edit/adjustments.h"
#include "edit/layer.h"
#include "edit/operation.h"
#include "image/image_buffer.h"
#include "jobs/cancellation.h"

namespace photoy {

/**
 * What a preview at a given viewport size will involve.
 *
 * Worked out before any pixels move, so the caller can decide whether the
 * geometry result it already holds still applies.
 */
struct PreviewPlan {
  Geometry geometry;
  /// Size of the geometry result, which is also the size of the preview.
  int width = 0;
  int height = 0;
  /// Size the document would have at full resolution, after the edit stack.
  int document_width = 0;
  int document_height = 0;
  /// Rendered width divided by document width, in the range (0, 1].
  double scale = 1.0;

  /// Whether a cached base rendered under `other` can be reused for this plan.
  bool Matches(const PreviewPlan& other) const noexcept;
};

PreviewPlan PlanPreview(const std::vector<Operation>& operations, int source_width,
                        int source_height, int max_width, int max_height);

/**
 * The geometric half: crop, downscale and orient, staying in the working space.
 *
 * Split out because it is the expensive half and the half a moving slider does
 * not change. Its cost is proportional to the source image; everything after it
 * is proportional to the viewport.
 */
Image16 RenderGeometry(const Image16& source, const PreviewPlan& plan,
                       const CancellationTokenPtr& token);

/**
 * The colour half: composites the layer stack and converts out, in one walk.
 *
 * All but the topmost visible layer run as their own pass over a working copy;
 * the topmost is fused into the conversion. A document with no layers, or with
 * one, therefore costs exactly what it did before layers existed.
 */
Image8 ComposeToOutput8(const Image16& base, const std::vector<Layer>& layers,
                        color::OutputSpace space, const CancellationTokenPtr& token);

/// The same, at the depth a PNG or TIFF export can keep.
Image16 ComposeToOutput16(const Image16& base, const std::vector<Layer>& layers,
                          color::OutputSpace space, const CancellationTokenPtr& token);

/// Evaluates the geometry at full resolution, for export.
Image16 RenderFull(const Image16& source, const std::vector<Operation>& operations,
                   const CancellationTokenPtr& token);

}  // namespace photoy
