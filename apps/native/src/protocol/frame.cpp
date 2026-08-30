#include "protocol/frame.h"

#include <cstring>
#include <string>

namespace photoy::protocol {
namespace {

void AppendLittleEndianU32(std::vector<std::uint8_t>& target, std::uint32_t value) {
  target.push_back(static_cast<std::uint8_t>(value & 0xFF));
  target.push_back(static_cast<std::uint8_t>((value >> 8) & 0xFF));
  target.push_back(static_cast<std::uint8_t>((value >> 16) & 0xFF));
  target.push_back(static_cast<std::uint8_t>((value >> 24) & 0xFF));
}

}  // namespace

std::vector<std::uint8_t> EncodeFrame(const Frame& frame) {
  const std::string header = frame.header.dump();

  std::vector<std::uint8_t> bytes;
  bytes.reserve(8 + header.size() + frame.payload.size());
  AppendLittleEndianU32(bytes, static_cast<std::uint32_t>(header.size()));
  bytes.insert(bytes.end(), header.begin(), header.end());
  AppendLittleEndianU32(bytes, static_cast<std::uint32_t>(frame.payload.size()));
  bytes.insert(bytes.end(), frame.payload.begin(), frame.payload.end());
  return bytes;
}

}  // namespace photoy::protocol
