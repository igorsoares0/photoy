#include "edit/render.h"

#include <algorithm>

#include "color/pipeline.h"
#include "core/error.h"
#include "image/resample.h"

namespace photoy {
namespace {

void EnsureRenderable(const Geometry& geometry) {
  if (geometry.source_rect.empty()) {
    throw EngineException(error_code::kInvalidRequest, "Nothing left to render",
                          "the edit stack crops the image away entirely");
  }
}

/// Extracts a sub-rectangle without resampling.
Image16 CopyRegion(const Image16& source, const Rect& region, const CancellationTokenPtr& token) {
  Image16 result = Image16::Create(region.width, region.height);
  for (int y = 0; y < region.height; ++y) {
    if (token->cancelled()) {
      throw EngineException(error_code::kCancelled, "Render cancelled", "superseded");
    }
    std::copy_n(source.Row(region.y + y) + static_cast<std::size_t>(region.x) * kChannels,
                static_cast<std::size_t>(region.width) * kChannels, result.Row(y));
  }
  return result;
}

/// Wraps the compiled adjustments as the per-pixel step the converter takes.
struct AdjustStep {
  const CompiledAdjustments& adjustments;
  void operator()(float& r, float& g, float& b) const noexcept { adjustments.Apply(r, g, b); }
};

}  // namespace

bool PreviewPlan::Matches(const PreviewPlan& other) const noexcept {
  return width == other.width && height == other.height &&
         geometry.orientation == other.geometry.orientation &&
         geometry.source_rect.x == other.geometry.source_rect.x &&
         geometry.source_rect.y == other.geometry.source_rect.y &&
         geometry.source_rect.width == other.geometry.source_rect.width &&
         geometry.source_rect.height == other.geometry.source_rect.height;
}

PreviewPlan PlanPreview(const std::vector<Operation>& operations, int source_width,
                        int source_height, int max_width, int max_height) {
  PreviewPlan plan;
  plan.geometry = FoldGeometry(operations, source_width, source_height);
  EnsureRenderable(plan.geometry);

  plan.document_width = plan.geometry.OutputWidth();
  plan.document_height = plan.geometry.OutputHeight();

  const FitResult fit =
      FitInside(plan.document_width, plan.document_height, max_width, max_height);
  plan.width = fit.width;
  plan.height = fit.height;
  plan.scale = fit.scale;
  return plan;
}

Image16 RenderGeometry(const Image16& source, const PreviewPlan& plan,
                       const CancellationTokenPtr& token) {
  // The fit is expressed in output coordinates; the resample runs before the
  // rotation, so the axes swap back for it.
  const bool swap = SwapsAxes(plan.geometry.orientation);
  const int resample_width = swap ? plan.height : plan.width;
  const int resample_height = swap ? plan.width : plan.height;

  const bool needs_resize = resample_width != plan.geometry.source_rect.width ||
                            resample_height != plan.geometry.source_rect.height;
  Image16 region =
      needs_resize ? DownscaleBox(source, plan.geometry.source_rect, resample_width,
                                  resample_height, token)
                   : CopyRegion(source, plan.geometry.source_rect, token);

  // Most documents are upright. Calling ApplyOrientation anyway would clone a
  // full working buffer to produce the pixels we already have.
  if (plan.geometry.orientation == Orientation::kTopLeft) return region;
  return ApplyOrientation(region, plan.geometry.orientation, token);
}

Image8 RenderOutput(const Image16& base, const Adjustments& adjustments, color::OutputSpace space,
                    const CancellationTokenPtr& token) {
  Image8 result = Image8::Create(base.width(), base.height());
  if (adjustments.IsNeutral()) {
    color::ConvertBanded(base, result, space, token, color::NoPreProcess{});
    return result;
  }
  const CompiledAdjustments compiled(adjustments);
  color::ConvertBanded(base, result, space, token, AdjustStep{compiled});
  return result;
}

Image16 RenderFull(const Image16& source, const std::vector<Operation>& operations,
                   const CancellationTokenPtr& token) {
  const Geometry geometry = FoldGeometry(operations, source.width(), source.height());
  EnsureRenderable(geometry);

  const bool untouched = geometry.orientation == Orientation::kTopLeft &&
                         geometry.source_rect.x == 0 && geometry.source_rect.y == 0 &&
                         geometry.source_rect.width == source.width() &&
                         geometry.source_rect.height == source.height();
  if (untouched) return source.Clone();

  return ApplyOrientation(CopyRegion(source, geometry.source_rect, token), geometry.orientation,
                          token);
}

}  // namespace photoy
