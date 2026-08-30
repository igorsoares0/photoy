#pragma once

#include <vector>

#include "color/primaries.h"
#include "edit/adjustments.h"
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

/// The colour half: adjustments and the conversion out, fused into one pass.
Image8 RenderOutput(const Image16& base, const Adjustments& adjustments, color::OutputSpace space,
                    const CancellationTokenPtr& token);

/// Evaluates the geometry at full resolution, for export.
Image16 RenderFull(const Image16& source, const std::vector<Operation>& operations,
                   const CancellationTokenPtr& token);

}  // namespace photoy
