#include "edit/serialize.h"

#include <algorithm>

#include "core/json.h"

namespace photoy {
namespace {

using nlohmann::json;
using json_util::OptionalFloat;
using json_util::OptionalInt;

/**
 * Largest side a resize may ask for.
 *
 * 30000 squared at 8 bytes a pixel is 7 GB, so this is not a generous limit -
 * it is the point past which the honest answer is a refusal rather than an
 * allocation failure halfway through an export.
 */
constexpr int kMaxResize = 30000;
using json_util::RequireInt;
using json_util::RequireString;

json AdjustmentsToJson(const Adjustments& a) {
  return json{{"exposure", a.exposure},     {"brightness", a.brightness},
              {"contrast", a.contrast},     {"highlights", a.highlights},
              {"shadows", a.shadows},       {"saturation", a.saturation},
              {"temperature", a.temperature}};
}

Adjustments AdjustmentsFromJson(const json& value) {
  const json& v = value.is_object() ? value : json::object();
  Adjustments a;
  a.exposure = std::clamp(OptionalFloat(v, "exposure", 0.0f), -5.0f, 5.0f);
  a.brightness = std::clamp(OptionalFloat(v, "brightness", 0.0f), -100.0f, 100.0f);
  a.contrast = std::clamp(OptionalFloat(v, "contrast", 0.0f), -100.0f, 100.0f);
  a.highlights = std::clamp(OptionalFloat(v, "highlights", 0.0f), -100.0f, 100.0f);
  a.shadows = std::clamp(OptionalFloat(v, "shadows", 0.0f), -100.0f, 100.0f);
  a.saturation = std::clamp(OptionalFloat(v, "saturation", 0.0f), -100.0f, 100.0f);
  a.temperature = std::clamp(OptionalFloat(v, "temperature", 0.0f), -100.0f, 100.0f);
  return a;
}

json MaskToJson(const Mask& mask) {
  return json{{"kind", MaskKindName(mask.kind)}, {"x", mask.x},         {"y", mask.y},
              {"angle", mask.angle},             {"radius", mask.radius},
              {"feather", mask.feather},         {"invert", mask.invert},
              {"low", mask.low},                 {"high", mask.high},
              {"raster", mask.raster},           {"rasterWidth", mask.raster_width},
              {"rasterHeight", mask.raster_height}};
}

Mask MaskFromJson(const json& value) {
  const json& v = value.is_object() ? value : json::object();
  Mask mask;
  mask.kind = MaskKindFromName(v.value("kind", std::string("none")));
  mask.x = std::clamp(OptionalFloat(v, "x", 0.5f), -1.0f, 2.0f);
  mask.y = std::clamp(OptionalFloat(v, "y", 0.5f), -1.0f, 2.0f);
  mask.angle = OptionalFloat(v, "angle", 0.0f);
  mask.radius = std::clamp(OptionalFloat(v, "radius", 0.35f), 0.0f, 4.0f);
  mask.feather = std::clamp(OptionalFloat(v, "feather", 0.25f), 0.0f, 4.0f);
  mask.invert = v.value("invert", false);
  mask.low = std::clamp(OptionalFloat(v, "low", 0.0f), 0.0f, 1.0f);
  mask.high = std::clamp(OptionalFloat(v, "high", 1.0f), 0.0f, 1.0f);
  mask.raster = v.contains("raster") && v.at("raster").is_number_unsigned()
                    ? v.at("raster").get<std::uint64_t>()
                    : 0;
  mask.raster_width = OptionalInt(v, "rasterWidth", 0);
  mask.raster_height = OptionalInt(v, "rasterHeight", 0);
  return mask;
}

std::uint64_t LayerId(const json& value) {
  return value.contains("layerId") && value.at("layerId").is_number_unsigned()
             ? value.at("layerId").get<std::uint64_t>()
             : 0;
}

}  // namespace

json ToJson(const Operation& operation) {
  json entry{{"kind", operation.KindName()}};
  switch (operation.kind) {
    case OperationKind::kRotate:
      entry["quarters"] = operation.quarters;
      break;
    case OperationKind::kCrop:
      entry["rect"] = json{{"x", operation.rect.x},
                           {"y", operation.rect.y},
                           {"width", operation.rect.width},
                           {"height", operation.rect.height}};
      break;
    case OperationKind::kAdjust:
      entry["adjustments"] = AdjustmentsToJson(operation.adjustments);
      entry["layerId"] = operation.target_layer;
      break;
    case OperationKind::kAddLayer:
      entry["name"] = operation.name;
      entry["layerKind"] = LayerKindName(operation.layer_kind);
      break;
    case OperationKind::kRemoveLayer:
      entry["layerId"] = operation.target_layer;
      break;
    case OperationKind::kReorderLayer:
      entry["layerId"] = operation.target_layer;
      entry["index"] = operation.index;
      break;
    case OperationKind::kSetLayerVisible:
      entry["layerId"] = operation.target_layer;
      entry["visible"] = operation.flag;
      break;
    case OperationKind::kSetLayerOpacity:
      entry["layerId"] = operation.target_layer;
      entry["opacity"] = operation.amount;
      break;
    case OperationKind::kSetLayerBlend:
      entry["layerId"] = operation.target_layer;
      entry["blend"] = BlendModeName(operation.blend);
      break;
    case OperationKind::kSetLayerMask:
      entry["layerId"] = operation.target_layer;
      entry["mask"] = MaskToJson(operation.mask);
      break;
    case OperationKind::kSetLayerFill:
      entry["layerId"] = operation.target_layer;
      entry["fill"] = FillKindName(operation.fill);
      entry["color"] = json{{"r", operation.color.r}, {"g", operation.color.g},
                            {"b", operation.color.b}};
      break;
    case OperationKind::kResize:
      entry["width"] = operation.target_width;
      entry["height"] = operation.target_height;
      break;
    case OperationKind::kSetLayerDecontaminate:
      entry["layerId"] = operation.target_layer;
      entry["decontaminate"] = operation.amount;
      break;
    case OperationKind::kFlipHorizontal:
    case OperationKind::kFlipVertical:
      break;
  }
  return entry;
}

Operation FromJson(const json& value) {
  const std::string kind = RequireString(value, "kind");
  Operation operation;

  if (kind == "rotate") {
    operation.kind = OperationKind::kRotate;
    const int quarters = ((OptionalInt(value, "quarters", 1) % 4) + 4) % 4;
    if (quarters == 0) {
      throw EngineException(error_code::kInvalidRequest, "Rotation would do nothing",
                            "quarters must not be a multiple of four");
    }
    operation.quarters = quarters;
    return operation;
  }
  if (kind == "flipHorizontal") {
    operation.kind = OperationKind::kFlipHorizontal;
    return operation;
  }
  if (kind == "flipVertical") {
    operation.kind = OperationKind::kFlipVertical;
    return operation;
  }
  if (kind == "crop") {
    operation.kind = OperationKind::kCrop;
    if (!value.contains("rect") || !value.at("rect").is_object()) {
      throw EngineException(error_code::kInvalidRequest, "Missing request parameter",
                            "crop needs a rect");
    }
    const json& rect = value.at("rect");
    operation.rect = {RequireInt(rect, "x"), RequireInt(rect, "y"), RequireInt(rect, "width"),
                      RequireInt(rect, "height")};
    if (operation.rect.empty()) {
      throw EngineException(error_code::kInvalidRequest, "Crop rectangle is empty",
                            "width and height must both be positive");
    }
    return operation;
  }
  if (kind == "adjust") {
    operation.kind = OperationKind::kAdjust;
    operation.target_layer = LayerId(value);
    operation.adjustments =
        AdjustmentsFromJson(value.contains("adjustments") ? value.at("adjustments") : json::object());
    return operation;
  }
  if (kind == "addLayer") {
    operation.kind = OperationKind::kAddLayer;
    operation.name = value.value("name", std::string{});
    operation.layer_kind = value.value("layerKind", std::string("adjustment")) == "matte"
                               ? LayerKind::kMatte
                               : LayerKind::kAdjustment;
    return operation;
  }
  if (kind == "setLayerFill") {
    operation.kind = OperationKind::kSetLayerFill;
    operation.target_layer = LayerId(value);
    operation.fill = FillKindFromName(value.value("fill", std::string("transparent")));
    const json& c = value.contains("color") && value.at("color").is_object() ? value.at("color")
                                                                            : json::object();
    operation.color.r = std::clamp(OptionalFloat(c, "r", 1.0f), 0.0f, 1.0f);
    operation.color.g = std::clamp(OptionalFloat(c, "g", 1.0f), 0.0f, 1.0f);
    operation.color.b = std::clamp(OptionalFloat(c, "b", 1.0f), 0.0f, 1.0f);
    return operation;
  }
  if (kind == "resize") {
    operation.kind = OperationKind::kResize;
    // Clamped rather than trusted: the target is what the export allocates, and
    // an absurd one is a memory failure rather than a picture.
    operation.target_width = std::clamp(OptionalInt(value, "width", 0), 1, kMaxResize);
    operation.target_height = std::clamp(OptionalInt(value, "height", 0), 1, kMaxResize);
    return operation;
  }
  if (kind == "setLayerDecontaminate") {
    operation.kind = OperationKind::kSetLayerDecontaminate;
    operation.target_layer = LayerId(value);
    operation.amount = std::clamp(OptionalFloat(value, "decontaminate", 1.0f), 0.0f, 1.0f);
    return operation;
  }
  if (kind == "removeLayer") {
    operation.kind = OperationKind::kRemoveLayer;
    operation.target_layer = LayerId(value);
    return operation;
  }
  if (kind == "reorderLayer") {
    operation.kind = OperationKind::kReorderLayer;
    operation.target_layer = LayerId(value);
    operation.index = OptionalInt(value, "index", 1);
    return operation;
  }
  if (kind == "setLayerVisible") {
    operation.kind = OperationKind::kSetLayerVisible;
    operation.target_layer = LayerId(value);
    operation.flag = value.value("visible", true);
    return operation;
  }
  if (kind == "setLayerOpacity") {
    operation.kind = OperationKind::kSetLayerOpacity;
    operation.target_layer = LayerId(value);
    operation.amount = std::clamp(OptionalFloat(value, "opacity", 1.0f), 0.0f, 1.0f);
    return operation;
  }
  if (kind == "setLayerMask") {
    operation.kind = OperationKind::kSetLayerMask;
    operation.target_layer = LayerId(value);
    operation.mask = MaskFromJson(value.contains("mask") ? value.at("mask") : json::object());
    return operation;
  }
  if (kind == "setLayerBlend") {
    operation.kind = OperationKind::kSetLayerBlend;
    operation.target_layer = LayerId(value);
    operation.blend = BlendModeFromName(value.value("blend", std::string("normal")));
    return operation;
  }
  throw EngineException(error_code::kInvalidRequest, "Unknown operation", kind);
}

json ToJson(const std::vector<Operation>& operations) {
  json array = json::array();
  for (const Operation& operation : operations) array.push_back(ToJson(operation));
  return array;
}

std::vector<Operation> OperationsFromJson(const json& value) {
  std::vector<Operation> operations;
  if (!value.is_array()) return operations;
  operations.reserve(value.size());
  for (const json& entry : value) operations.push_back(FromJson(entry));
  return operations;
}

}  // namespace photoy
