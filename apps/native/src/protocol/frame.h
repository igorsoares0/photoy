#pragma once

#include <cstdint>
#include <vector>

#include <nlohmann/json.hpp>

namespace photoy::protocol {

/// Version reported by engine.describe; bump when the framing or method set
/// changes in a way an older host cannot handle.
inline constexpr int kProtocolVersion = 1;

/// Sanity bounds mirroring packages/ipc/src/wire.ts.
inline constexpr std::uint32_t kMaxHeaderBytes = 1u << 20;
inline constexpr std::uint32_t kMaxPayloadBytes = 1u << 30;

/// One protocol message: a JSON header plus an optional raw payload. Pixels
/// ride in the payload so they never pass through JSON encoding.
struct Frame {
  nlohmann::json header;
  std::vector<std::uint8_t> payload;
};

/// Serialises a frame into the length-prefixed wire form.
std::vector<std::uint8_t> EncodeFrame(const Frame& frame);

}  // namespace photoy::protocol
