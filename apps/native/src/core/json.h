#pragma once

#include <string>

#include <nlohmann/json.hpp>

#include "core/error.h"

namespace photoy::json_util {

/// Reads a required string, failing with a message that names what was missing.
inline std::string RequireString(const nlohmann::json& object, const char* key) {
  if (!object.is_object() || !object.contains(key) || !object.at(key).is_string()) {
    throw EngineException(error_code::kInvalidRequest, "Missing request parameter",
                          std::string("expected string \"") + key + "\"");
  }
  return object.at(key).get<std::string>();
}

inline int RequireInt(const nlohmann::json& object, const char* key) {
  if (!object.is_object() || !object.contains(key) || !object.at(key).is_number_integer()) {
    throw EngineException(error_code::kInvalidRequest, "Missing request parameter",
                          std::string("expected integer \"") + key + "\"");
  }
  return object.at(key).get<int>();
}

inline int OptionalInt(const nlohmann::json& object, const char* key, int fallback) {
  if (!object.is_object() || !object.contains(key) || !object.at(key).is_number()) return fallback;
  return object.at(key).get<int>();
}

inline float OptionalFloat(const nlohmann::json& object, const char* key, float fallback) {
  if (!object.is_object() || !object.contains(key) || !object.at(key).is_number()) return fallback;
  return object.at(key).get<float>();
}

}  // namespace photoy::json_util
