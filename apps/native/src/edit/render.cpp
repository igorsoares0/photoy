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

/// Wraps a compiled layer as the per-pixel step the converter takes.
struct LayerStep {
  const CompiledLayer& layer;
  void operator()(float& r, float& g, float& b, int x, int y) const noexcept {
    layer.Apply(r, g, b, x, y);
  }
};

/// Runs one layer over a working buffer, in place.
void ApplyInPlace(Image16& image, const CompiledLayer& layer, const CancellationTokenPtr& token) {
  constexpr float kFromSample = 1.0f / 65535.0f;
  for (int y = 0; y < image.height(); ++y) {
    if (token->cancelled()) {
      throw EngineException(error_code::kCancelled, "Render cancelled", "superseded");
    }
    std::uint16_t* row = image.Row(y);
    for (int x = 0; x < image.width(); ++x) {
      const std::size_t index = static_cast<std::size_t>(x) * kChannels;
      float r = row[index + 0] * kFromSample;
      float g = row[index + 1] * kFromSample;
      float b = row[index + 2] * kFromSample;
      layer.Apply(r, g, b, x, y);
      const auto store = [](float value) {
        const float scaled = value * 65535.0f + 0.5f;
        return static_cast<std::uint16_t>(scaled <= 0.0f ? 0.0f
                                                         : (scaled >= 65535.0f ? 65535.0f : scaled));
      };
      row[index + 0] = store(r);
      row[index + 1] = store(g);
      row[index + 2] = store(b);
    }
  }
}

/// The visible layers that actually change something, bottom first.
std::vector<CompiledLayer> Compile(const std::vector<Layer>& layers, int width, int height) {
  std::vector<CompiledLayer> compiled;
  for (const Layer& layer : layers) {
    if (layer.kind != LayerKind::kAdjustment || !layer.visible) continue;
    CompiledLayer candidate(layer, width, height);
    if (candidate.transparent()) continue;
    compiled.push_back(std::move(candidate));
  }
  return compiled;
}

template <typename Out>
TImageBuffer<Out> Compose(const Image16& base, const std::vector<Layer>& layers,
                          color::OutputSpace space, const CancellationTokenPtr& token) {
  // Masks are described in fractions of the document, so they compile against
  // whatever resolution this render happens to be: the same mask at preview
  // size and at full size, with no downscale in between.
  const std::vector<CompiledLayer> compiled = Compile(layers, base.width(), base.height());
  TImageBuffer<Out> result = TImageBuffer<Out>::Create(base.width(), base.height());

  if (compiled.empty()) {
    color::ConvertBanded(base, result, space, token, color::NoPreProcess{});
    return result;
  }

  // Only the layers below the top need a buffer of their own. Fusing the top
  // one into the conversion is what keeps the usual case - none, or one - at
  // the cost it had before layers existed.
  Image16 scratch;
  const Image16* input = &base;
  if (compiled.size() > 1) {
    scratch = base.Clone();
    for (std::size_t i = 0; i + 1 < compiled.size(); ++i) {
      ApplyInPlace(scratch, compiled[i], token);
    }
    input = &scratch;
  }
  color::ConvertBanded(*input, result, space, token, LayerStep{compiled.back()});
  return result;
}

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

Image8 ComposeToOutput8(const Image16& base, const std::vector<Layer>& layers,
                        color::OutputSpace space, const CancellationTokenPtr& token) {
  return Compose<std::uint8_t>(base, layers, space, token);
}

Image16 ComposeToOutput16(const Image16& base, const std::vector<Layer>& layers,
                          color::OutputSpace space, const CancellationTokenPtr& token) {
  return Compose<std::uint16_t>(base, layers, space, token);
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
