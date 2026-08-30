#pragma once

#include <string_view>

namespace photoy::log {

enum class Level { kDebug, kInfo, kWarn, kError };

/// Reads PHOTOY_LOG_LEVEL (debug|info|warn|error) once, defaulting to info.
void InitFromEnvironment();

void Write(Level level, std::string_view message);

/// True when a message at this level would be printed. Call it before building
/// a diagnostic string on a hot path - Write would otherwise pay for the
/// formatting and then throw it away.
bool Enabled(Level level) noexcept;

inline void Debug(std::string_view m) { Write(Level::kDebug, m); }
inline void Info(std::string_view m) { Write(Level::kInfo, m); }
inline void Warn(std::string_view m) { Write(Level::kWarn, m); }
inline void Error(std::string_view m) { Write(Level::kError, m); }

}  // namespace photoy::log
