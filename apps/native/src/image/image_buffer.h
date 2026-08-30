#pragma once

#include <cstddef>
#include <cstdint>
#include <limits>
#include <cstring>
#include <new>
#include <string>
#include <type_traits>
#include <vector>

#include "core/error.h"

namespace photoy {

/// Number of channels in every buffer the engine hands around.
inline constexpr int kChannels = 4;

/// Upper bound on a single dimension. Generous enough for gigapixel scans while
/// still rejecting nonsense from a corrupt header before it reaches malloc.
inline constexpr int kMaxDimension = 65535;

/**
 * An RGBA image with tightly packed rows.
 *
 * Two instantiations exist. Image16 is the working format: everything the
 * engine edits and composites lives there, wide enough that a chain of
 * adjustments does not band. Image8 is what leaves the engine, once for the
 * screen and once for a file.
 *
 * Alpha is unassociated throughout - colour channels are never premultiplied
 * except transiently inside a resample.
 */
template <typename Sample>
class TImageBuffer {
 public:
  using SampleType = Sample;
  static constexpr Sample kMaxValue = std::numeric_limits<Sample>::max();

  TImageBuffer() = default;

  /// Allocates a zeroed buffer. Throws EngineException when the dimensions are
  /// out of range or the allocation would overflow.
  static TImageBuffer Create(int width, int height) {
    if (width <= 0 || height <= 0 || width > kMaxDimension || height > kMaxDimension) {
      throw EngineException(error_code::kDecodeFailed, "Unsupported image dimensions",
                            std::to_string(width) + "x" + std::to_string(height));
    }

    const std::size_t samples_per_row = static_cast<std::size_t>(width) * kChannels;
    const std::size_t rows = static_cast<std::size_t>(height);
    if (samples_per_row > std::numeric_limits<std::size_t>::max() / rows / sizeof(Sample)) {
      throw EngineException(error_code::kOutOfMemory, "Image is too large to allocate",
                            std::to_string(width) + "x" + std::to_string(height));
    }

    TImageBuffer buffer;
    buffer.width_ = width;
    buffer.height_ = height;
    buffer.samples_per_row_ = samples_per_row;
    try {
      buffer.samples_.assign(samples_per_row * rows, Sample{0});
    } catch (const std::bad_alloc&) {
      throw EngineException(error_code::kOutOfMemory, "Image is too large to allocate",
                            std::to_string(samples_per_row * rows * sizeof(Sample)) + " bytes");
    }
    return buffer;
  }

  int width() const noexcept { return width_; }
  int height() const noexcept { return height_; }
  bool empty() const noexcept { return width_ <= 0 || height_ <= 0; }

  /// Samples per row, which is width * kChannels.
  std::size_t samples_per_row() const noexcept { return samples_per_row_; }
  /// Bytes per row, as reported on the wire.
  std::size_t stride() const noexcept { return samples_per_row_ * sizeof(Sample); }
  std::size_t size_bytes() const noexcept { return samples_.size() * sizeof(Sample); }

  Sample* data() noexcept { return samples_.data(); }
  const Sample* data() const noexcept { return samples_.data(); }

  Sample* Row(int y) noexcept {
    return samples_.data() + static_cast<std::size_t>(y) * samples_per_row_;
  }
  const Sample* Row(int y) const noexcept {
    return samples_.data() + static_cast<std::size_t>(y) * samples_per_row_;
  }

  /// Reinterprets the storage as bytes, for handing to a codec or the wire.
  std::uint8_t* bytes() noexcept { return reinterpret_cast<std::uint8_t*>(samples_.data()); }
  const std::uint8_t* bytes() const noexcept {
    return reinterpret_cast<const std::uint8_t*>(samples_.data());
  }

  /**
   * Releases the samples as a byte vector, leaving an empty buffer behind.
   *
   * For an 8-bit buffer the storage already is a byte vector, so it moves out
   * rather than being copied - which matters, because this sits on the path
   * every preview takes to the screen.
   */
  std::vector<std::uint8_t> TakeBytes() {
    std::vector<std::uint8_t> out;
    if constexpr (std::is_same_v<Sample, std::uint8_t>) {
      out = std::move(samples_);
    } else {
      out.resize(size_bytes());
      if (!out.empty()) std::memcpy(out.data(), bytes(), out.size());
    }
    samples_.clear();
    samples_.shrink_to_fit();
    width_ = 0;
    height_ = 0;
    samples_per_row_ = 0;
    return out;
  }

  TImageBuffer Clone() const {
    if (empty()) return {};
    TImageBuffer copy = Create(width_, height_);
    copy.samples_ = samples_;
    return copy;
  }

 private:
  int width_ = 0;
  int height_ = 0;
  std::size_t samples_per_row_ = 0;
  std::vector<Sample> samples_;
};

using Image8 = TImageBuffer<std::uint8_t>;
using Image16 = TImageBuffer<std::uint16_t>;

/// Widens an 8-bit sample so that 255 maps exactly to 65535.
inline std::uint16_t Widen8To16(std::uint8_t value) noexcept {
  return static_cast<std::uint16_t>(value * 257);
}

/// Promotes an 8-bit decode into the engine's working precision.
Image16 Widen(const Image8& source);

}  // namespace photoy
