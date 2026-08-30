#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "decoder/decoder.h"

namespace photoy {

/// Identifies a container from its leading bytes. Content decides the format,
/// never the extension, so a mislabelled file still opens correctly.
ImageFormat SniffFormat(const std::vector<std::uint8_t>& bytes) noexcept;

/// Maps a lowercase extension or wire name to a format, for export targets.
ImageFormat FormatFromName(const std::string& name) noexcept;

}  // namespace photoy
