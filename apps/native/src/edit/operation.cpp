#include "edit/operation.h"

#include <algorithm>
#include <cmath>

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
    case OperationKind::kResize: return "resize";
    case OperationKind::kAdjust: return "adjust";
    case OperationKind::kAddLayer: return "addLayer";
    case OperationKind::kRemoveLayer: return "removeLayer";
    case OperationKind::kReorderLayer: return "reorderLayer";
    case OperationKind::kSetLayerVisible: return "setLayerVisible";
    case OperationKind::kSetLayerOpacity: return "setLayerOpacity";
    case OperationKind::kSetLayerBlend: return "setLayerBlend";
    case OperationKind::kSetLayerMask: return "setLayerMask";
    case OperationKind::kSetLayerFill: return "setLayerFill";
    case OperationKind::kSetLayerDecontaminate: return "setLayerDecontaminate";
    case OperationKind::kSetLayerPatch: return "setLayerPatch";
    case OperationKind::kDevelopRaw: return "developRaw";
  }
  return "unknown";
}

int Geometry::NaturalWidth() const noexcept {
  return SwapsAxes(orientation) ? source_rect.height : source_rect.width;
}

int Geometry::NaturalHeight() const noexcept {
  return SwapsAxes(orientation) ? source_rect.width : source_rect.height;
}

int Geometry::OutputWidth() const noexcept {
  return target_width > 0 ? target_width : NaturalWidth();
}

int Geometry::OutputHeight() const noexcept {
  return target_height > 0 ? target_height : NaturalHeight();
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
        // A resized size is in output coordinates, so a quarter turn carries it
        // round with everything else.
        if (operation.quarters % 2 != 0) {
          std::swap(geometry.target_width, geometry.target_height);
        }
        break;
      case OperationKind::kFlipHorizontal:
        geometry.orientation = Compose(FlipHorizontal(), geometry.orientation);
        break;
      case OperationKind::kFlipVertical:
        geometry.orientation = Compose(FlipVertical(), geometry.orientation);
        break;
      case OperationKind::kAdjust:
      case OperationKind::kAddLayer:
      case OperationKind::kRemoveLayer:
      case OperationKind::kReorderLayer:
      case OperationKind::kSetLayerVisible:
      case OperationKind::kSetLayerOpacity:
      case OperationKind::kSetLayerBlend:
      case OperationKind::kSetLayerMask:
      case OperationKind::kSetLayerFill:
      case OperationKind::kSetLayerDecontaminate:
      case OperationKind::kSetLayerPatch:
        break;  // colour and compositing only; the shape is untouched
      case OperationKind::kDevelopRaw:
        // Changes what the decoder produces, not its shape: a different white
        // balance is the same pixels in different colours.
        break;
      case OperationKind::kResize: {
        geometry.target_width = std::max(1, operation.target_width);
        geometry.target_height = std::max(1, operation.target_height);
        break;
      }
      case OperationKind::kCrop: {
        // The crop is expressed against what the user sees, so it is mapped
        // back through the accumulated orientation and then clipped to what is
        // still left of the original. When a resize is in effect, what the user
        // sees is also scaled, so the rect comes back through that first.
        const double scale_x = geometry.target_width > 0
                                   ? static_cast<double>(geometry.NaturalWidth()) /
                                         geometry.target_width
                                   : 1.0;
        const double scale_y = geometry.target_height > 0
                                    ? static_cast<double>(geometry.NaturalHeight()) /
                                          geometry.target_height
                                    : 1.0;
        const Rect in_natural{static_cast<int>(std::lround(operation.rect.x * scale_x)),
                              static_cast<int>(std::lround(operation.rect.y * scale_y)),
                              std::max(1, static_cast<int>(std::lround(operation.rect.width * scale_x))),
                              std::max(1, static_cast<int>(std::lround(operation.rect.height * scale_y)))};

        const Rect in_source = MapRectBack(in_natural, geometry.orientation,
                                           geometry.source_rect.width, geometry.source_rect.height);
        const Rect shifted{in_source.x + geometry.source_rect.x,
                           in_source.y + geometry.source_rect.y, in_source.width,
                           in_source.height};
        geometry.source_rect = Intersect(shifted, geometry.source_rect);

        // A crop takes a smaller piece of the picture; it does not change how
        // big a pixel is. Holding the resample ratio is what keeps that true.
        if (geometry.target_width > 0) {
          geometry.target_width =
              std::max(1, static_cast<int>(std::lround(geometry.NaturalWidth() / scale_x)));
          geometry.target_height =
              std::max(1, static_cast<int>(std::lround(geometry.NaturalHeight() / scale_y)));
        }
        break;
      }
    }
  }
  return geometry;
}

namespace {

/// Finds a layer by id, or the topmost adjustment layer when the id is zero.
Layer* Resolve(std::vector<Layer>& layers, std::uint64_t id) {
  if (id != 0) {
    for (Layer& layer : layers) {
      if (layer.id == id) return &layer;
    }
    return nullptr;
  }
  for (auto it = layers.rbegin(); it != layers.rend(); ++it) {
    if (it->kind == LayerKind::kAdjustment) return &*it;
  }
  return nullptr;
}

}  // namespace

std::vector<Layer> FoldLayers(const std::vector<Operation>& operations) {
  std::vector<Layer> layers;
  layers.push_back(Layer{0, LayerKind::kBackground, true, 1.0f, BlendMode::kNormal, {}, {}});
  std::uint64_t next_id = 1;

  const auto add = [&layers, &next_id](std::string name, LayerKind kind) -> Layer& {
    Layer layer;
    layer.id = next_id++;
    layer.kind = kind;
    layer.name = std::move(name);
    layers.push_back(layer);
    return layers.back();
  };

  for (const Operation& operation : operations) {
    switch (operation.kind) {
      case OperationKind::kAddLayer:
        add(operation.name, operation.layer_kind);
        break;

      case OperationKind::kAdjust: {
        Layer* target = Resolve(layers, operation.target_layer);
        // An adjustment with nowhere to go creates the layer it needs, so a
        // document can be adjusted without anyone having to think about layers.
        if (target == nullptr) target = &add({}, LayerKind::kAdjustment);
        target->adjustments = operation.adjustments;
        break;
      }

      case OperationKind::kRemoveLayer: {
        const auto it = std::find_if(layers.begin(), layers.end(), [&](const Layer& layer) {
          return layer.id == operation.target_layer && layer.kind != LayerKind::kBackground;
        });
        if (it != layers.end()) layers.erase(it);
        break;
      }

      case OperationKind::kReorderLayer: {
        const auto from = std::find_if(layers.begin(), layers.end(), [&](const Layer& layer) {
          return layer.id == operation.target_layer && layer.kind != LayerKind::kBackground;
        });
        if (from == layers.end()) break;
        Layer moved = *from;
        layers.erase(from);
        // Index 0 is the background, which nothing may be placed below.
        const auto position = static_cast<std::size_t>(
            std::clamp<int>(operation.index, 1, static_cast<int>(layers.size())));
        layers.insert(layers.begin() + static_cast<std::ptrdiff_t>(position), moved);
        break;
      }

      case OperationKind::kSetLayerVisible: {
        Layer* target = Resolve(layers, operation.target_layer);
        if (target != nullptr) target->visible = operation.flag;
        break;
      }
      case OperationKind::kSetLayerOpacity: {
        Layer* target = Resolve(layers, operation.target_layer);
        if (target != nullptr) target->opacity = std::clamp(operation.amount, 0.0f, 1.0f);
        break;
      }
      case OperationKind::kSetLayerBlend: {
        Layer* target = Resolve(layers, operation.target_layer);
        if (target != nullptr) target->blend = operation.blend;
        break;
      }
      case OperationKind::kSetLayerMask: {
        Layer* target = Resolve(layers, operation.target_layer);
        if (target != nullptr) target->mask = operation.mask;
        break;
      }
      case OperationKind::kSetLayerFill: {
        Layer* target = Resolve(layers, operation.target_layer);
        if (target != nullptr) {
          target->fill = operation.fill;
          target->color = operation.color;
          target->blur = std::clamp(operation.amount, 0.0f, 100.0f);
        }
        break;
      }
      case OperationKind::kSetLayerDecontaminate: {
        Layer* target = Resolve(layers, operation.target_layer);
        if (target != nullptr) target->decontaminate = std::clamp(operation.amount, 0.0f, 1.0f);
        break;
      }
      case OperationKind::kSetLayerPatch: {
        Layer* target = Resolve(layers, operation.target_layer);
        if (target != nullptr) {
          target->patch = operation.patch;
          target->patch_width = operation.target_width;
          target->patch_height = operation.target_height;
        }
        break;
      }

      default:
        break;  // geometry, handled by FoldGeometry
    }
  }
  return layers;
}

RawSettings FoldRawSettings(const std::vector<Operation>& operations) noexcept {
  RawSettings settings;
  for (const Operation& operation : operations) {
    if (operation.kind == OperationKind::kDevelopRaw) settings = operation.raw;
  }
  return settings;
}

Adjustments FoldAdjustments(const std::vector<Operation>& operations) noexcept {
  const std::vector<Layer> layers = FoldLayers(operations);
  for (auto it = layers.rbegin(); it != layers.rend(); ++it) {
    if (it->kind == LayerKind::kAdjustment) return it->adjustments;
  }
  return {};
}

}  // namespace photoy
