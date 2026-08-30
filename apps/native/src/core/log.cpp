#include "core/log.h"

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <mutex>
#include <string>

namespace photoy::log {
namespace {

Level g_min_level = Level::kInfo;
std::mutex g_mutex;

const char* LevelName(Level level) {
  switch (level) {
    case Level::kDebug: return "debug";
    case Level::kInfo: return "info";
    case Level::kWarn: return "warn";
    case Level::kError: return "error";
  }
  return "info";
}

}  // namespace

void InitFromEnvironment() {
  const char* raw = std::getenv("PHOTOY_LOG_LEVEL");
  if (raw == nullptr) return;
  const std::string value(raw);
  if (value == "debug") g_min_level = Level::kDebug;
  else if (value == "info") g_min_level = Level::kInfo;
  else if (value == "warn") g_min_level = Level::kWarn;
  else if (value == "error") g_min_level = Level::kError;
}

bool Enabled(Level level) noexcept {
  return static_cast<int>(level) >= static_cast<int>(g_min_level);
}

void Write(Level level, std::string_view message) {
  if (static_cast<int>(level) < static_cast<int>(g_min_level)) return;
  // stdout carries the protocol, so diagnostics always go to stderr.
  const std::lock_guard<std::mutex> lock(g_mutex);
  std::fprintf(stderr, "[engine:%s] %.*s\n", LevelName(level),
               static_cast<int>(message.size()), message.data());
  std::fflush(stderr);
}

}  // namespace photoy::log
