#pragma once

#include <vector>

#include <nlohmann/json.hpp>

#include "edit/operation.h"

namespace photoy {

/**
 * The wire form of an operation - and its file form.
 *
 * A project stores exactly the JSON the protocol carries, so there is one
 * schema to keep correct rather than two that can drift apart. It also means
 * a project file can be read by anything that already speaks the protocol.
 */
nlohmann::json ToJson(const Operation& operation);

/// Parses one operation. Throws EngineException on anything malformed.
Operation FromJson(const nlohmann::json& value);

nlohmann::json ToJson(const std::vector<Operation>& operations);
std::vector<Operation> OperationsFromJson(const nlohmann::json& value);

/**
 * The wire form of the adjustment set on its own.
 *
 * Exported because the engine describes a layer's adjustments as well as
 * serialising the operation that set them, and two hand-written copies of the
 * same object drift the moment a control is added to one of them.
 */
nlohmann::json AdjustmentsToJson(const Adjustments& adjustments);
Adjustments AdjustmentsFromJson(const nlohmann::json& value);

}  // namespace photoy
