#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "color/profile.h"
#include "image/image_buffer.h"
#include "image/orientation.h"

namespace photoy {

enum class ImageFormat { kUnknown, kJpeg, kPng, kTiff, kWebp };

/// Lowercase wire name, matching the ImageFormat union in packages/types.
const char* FormatName(ImageFormat format) noexcept;

struct DecodedImage {
  /**
   * Upright pixels in the file's own colour space, widened to the engine's
   * working precision. Orientation is already applied; colour is not yet
   * converted, because that needs the profile below.
   */
  Image16 pixels;
  /// The embedded ICC profile, empty when the file carried none.
  color::IccBytes icc;
  /// Bits per channel in the source file, before widening.
  int bit_depth = 8;
  /// Whether the source actually carried transparency.
  bool has_alpha = false;
  /// Orientation the file declared, reported for the UI but already resolved.
  Orientation orientation = Orientation::kTopLeft;
};

/// Each decoder receives the whole file. Milestone 1 images fit in memory
/// comfortably; streaming belongs with the tiled pipeline in milestone 4.
DecodedImage DecodeJpeg(const std::vector<std::uint8_t>& bytes);
DecodedImage DecodePng(const std::vector<std::uint8_t>& bytes);
DecodedImage DecodeTiff(const std::vector<std::uint8_t>& bytes);
DecodedImage DecodeWebp(const std::vector<std::uint8_t>& bytes);

/// Sniffs the format and dispatches. Throws EngineException on failure.
DecodedImage Decode(const std::vector<std::uint8_t>& bytes, ImageFormat* out_format);

}  // namespace photoy
