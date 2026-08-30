#include "protocol/stdio_transport.h"

#include <cstdio>
#include <string>
#include <vector>

#include "core/error.h"

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

namespace photoy::protocol {
namespace {

std::uint32_t LittleEndianU32(const std::uint8_t* bytes) noexcept {
  return static_cast<std::uint32_t>(bytes[0]) | (static_cast<std::uint32_t>(bytes[1]) << 8) |
         (static_cast<std::uint32_t>(bytes[2]) << 16) |
         (static_cast<std::uint32_t>(bytes[3]) << 24);
}

}  // namespace

StdioTransport::StdioTransport() {
#ifdef _WIN32
  ::_setmode(::_fileno(stdin), _O_BINARY);
  ::_setmode(::_fileno(stdout), _O_BINARY);
#endif
  std::setvbuf(stdout, nullptr, _IOFBF, 1 << 16);
}

bool StdioTransport::ReadExact(void* target, std::size_t length) {
  auto* cursor = static_cast<std::uint8_t*>(target);
  std::size_t remaining = length;
  while (remaining > 0) {
    const std::size_t count = std::fread(cursor, 1, remaining, stdin);
    if (count == 0) return false;
    cursor += count;
    remaining -= count;
  }
  return true;
}

bool StdioTransport::Read(Frame& frame) {
  std::uint8_t length_bytes[4];
  if (!ReadExact(length_bytes, sizeof(length_bytes))) return false;

  const std::uint32_t header_length = LittleEndianU32(length_bytes);
  if (header_length == 0 || header_length > kMaxHeaderBytes) {
    throw EngineException(error_code::kInvalidRequest, "Malformed frame header",
                          "header length " + std::to_string(header_length));
  }

  std::string header(header_length, '\0');
  if (!ReadExact(header.data(), header_length)) {
    throw EngineException(error_code::kInvalidRequest, "Truncated frame header",
                          "expected " + std::to_string(header_length) + " bytes");
  }

  if (!ReadExact(length_bytes, sizeof(length_bytes))) {
    throw EngineException(error_code::kInvalidRequest, "Truncated frame", "missing payload length");
  }
  const std::uint32_t payload_length = LittleEndianU32(length_bytes);
  if (payload_length > kMaxPayloadBytes) {
    throw EngineException(error_code::kInvalidRequest, "Malformed frame payload",
                          "payload length " + std::to_string(payload_length));
  }

  frame.payload.assign(payload_length, 0);
  if (payload_length > 0 && !ReadExact(frame.payload.data(), payload_length)) {
    throw EngineException(error_code::kInvalidRequest, "Truncated frame payload",
                          "expected " + std::to_string(payload_length) + " bytes");
  }

  frame.header = nlohmann::json::parse(header, nullptr, /*allow_exceptions=*/false);
  if (frame.header.is_discarded()) {
    throw EngineException(error_code::kInvalidRequest, "Frame header is not valid JSON", header);
  }
  return true;
}

void StdioTransport::Write(const Frame& frame) {
  const std::vector<std::uint8_t> bytes = EncodeFrame(frame);
  const std::lock_guard<std::mutex> lock(write_mutex_);
  std::fwrite(bytes.data(), 1, bytes.size(), stdout);
  std::fflush(stdout);
}

}  // namespace photoy::protocol
