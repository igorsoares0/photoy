#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "color/primaries.h"

namespace photoy::color {

/// Raw bytes of an embedded ICC profile, exactly as they sat in the file.
using IccBytes = std::vector<std::uint8_t>;

OutputSpace OutputSpaceFromName(const std::string& name) noexcept;
const char* OutputSpaceName(OutputSpace space) noexcept;

/**
 * Owning handle to an ICC profile.
 *
 * The lcms type is hidden behind void* so that only the colour module needs
 * lcms2.h; everything else deals in Profile values.
 */
class Profile {
 public:
  Profile() = default;
  ~Profile();

  Profile(Profile&& other) noexcept;
  Profile& operator=(Profile&& other) noexcept;
  Profile(const Profile&) = delete;
  Profile& operator=(const Profile&) = delete;

  /// Parses an embedded profile. Returns an invalid Profile when the bytes are
  /// not a usable RGB profile, which is a fallback condition and not an error.
  static Profile FromIcc(const IccBytes& bytes);

  static Profile Srgb();
  static Profile DisplayP3();
  static Profile AdobeRgb();
  static Profile ForOutput(OutputSpace space);

  /// An ICC profile for the engine's working space, as defined in primaries.h.
  static Profile Working();

  bool valid() const noexcept { return handle_ != nullptr; }
  void* handle() const noexcept { return handle_; }

  /// ICC bytes for embedding in an exported file.
  IccBytes Serialize() const;

  /// Human-readable description, for logs and the UI.
  std::string Description() const;

 private:
  explicit Profile(void* handle) : handle_(handle) {}
  void* handle_ = nullptr;
};

}  // namespace photoy::color
