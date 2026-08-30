#include "image/orientation.h"

#include <cstring>

#include "core/error.h"

namespace photoy {
namespace {

/**
 * An orientation as a mirror followed by a clockwise rotation.
 *
 * Composition is awkward on the EXIF numbering but trivial here, so the group
 * arithmetic happens in this representation and converts back at the edges.
 */
struct Symmetry {
  int quarters = 0;  // clockwise quarter turns, 0-3
  bool mirrored = false;
};

Symmetry ToSymmetry(Orientation orientation) noexcept {
  switch (orientation) {
    case Orientation::kTopLeft: return {0, false};
    case Orientation::kTopRight: return {0, true};
    case Orientation::kBottomRight: return {2, false};
    case Orientation::kBottomLeft: return {2, true};
    case Orientation::kLeftTop: return {3, true};
    case Orientation::kRightTop: return {1, false};
    case Orientation::kRightBottom: return {1, true};
    case Orientation::kLeftBottom: return {3, false};
  }
  return {0, false};
}

Orientation FromSymmetry(Symmetry symmetry) noexcept {
  const int quarters = ((symmetry.quarters % 4) + 4) % 4;
  if (!symmetry.mirrored) {
    switch (quarters) {
      case 0: return Orientation::kTopLeft;
      case 1: return Orientation::kRightTop;
      case 2: return Orientation::kBottomRight;
      default: return Orientation::kLeftBottom;
    }
  }
  switch (quarters) {
    case 0: return Orientation::kTopRight;
    case 1: return Orientation::kRightBottom;
    case 2: return Orientation::kBottomLeft;
    default: return Orientation::kLeftTop;
  }
}

}  // namespace

Orientation OrientationFromInt(int value) noexcept {
  if (value < 1 || value > 8) return Orientation::kTopLeft;
  return static_cast<Orientation>(value);
}

bool SwapsAxes(Orientation orientation) noexcept {
  switch (orientation) {
    case Orientation::kLeftTop:
    case Orientation::kRightTop:
    case Orientation::kRightBottom:
    case Orientation::kLeftBottom:
      return true;
    default:
      return false;
  }
}

Orientation Compose(Orientation second, Orientation first) noexcept {
  const Symmetry a = ToSymmetry(first);
  const Symmetry b = ToSymmetry(second);
  // Mirroring conjugates rotation, so the first transform's turn count is
  // negated whenever the second one mirrors.
  return FromSymmetry({b.quarters + (b.mirrored ? -a.quarters : a.quarters),
                       a.mirrored != b.mirrored});
}

Orientation Inverse(Orientation orientation) noexcept {
  const Symmetry symmetry = ToSymmetry(orientation);
  // A mirror is its own inverse, and it swaps the sign of the rotation it is
  // paired with; a pure rotation just turns the other way.
  return symmetry.mirrored ? FromSymmetry({symmetry.quarters, true})
                           : FromSymmetry({-symmetry.quarters, false});
}

Orientation RotateQuarters(int quarters) noexcept {
  return FromSymmetry({quarters, false});
}

Orientation FlipHorizontal() noexcept { return Orientation::kTopRight; }

Orientation FlipVertical() noexcept { return Orientation::kBottomLeft; }

void MapPoint(Orientation orientation, int source_width, int source_height, int x, int y,
              int* out_x, int* out_y) noexcept {
  int target_x = x;
  int target_y = y;
  switch (orientation) {
    case Orientation::kTopLeft: break;
    case Orientation::kTopRight:
      target_x = source_width - 1 - x;
      break;
    case Orientation::kBottomRight:
      target_x = source_width - 1 - x;
      target_y = source_height - 1 - y;
      break;
    case Orientation::kBottomLeft:
      target_y = source_height - 1 - y;
      break;
    case Orientation::kLeftTop:
      target_x = y;
      target_y = x;
      break;
    case Orientation::kRightTop:
      target_x = source_height - 1 - y;
      target_y = x;
      break;
    case Orientation::kRightBottom:
      target_x = source_height - 1 - y;
      target_y = source_width - 1 - x;
      break;
    case Orientation::kLeftBottom:
      target_x = y;
      target_y = source_width - 1 - x;
      break;
  }
  *out_x = target_x;
  *out_y = target_y;
}

Image16 ApplyOrientation(const Image16& image, Orientation orientation,
                         const CancellationTokenPtr& token) {
  if (orientation == Orientation::kTopLeft || image.empty()) return image.Clone();

  const int source_width = image.width();
  const int source_height = image.height();
  const bool swap = SwapsAxes(orientation);
  Image16 result = Image16::Create(swap ? source_height : source_width,
                                   swap ? source_width : source_height);

  for (int y = 0; y < source_height; ++y) {
    if (token->cancelled()) {
      throw EngineException(error_code::kCancelled, "Render cancelled", "superseded");
    }
    const std::uint16_t* source_row = image.Row(y);
    for (int x = 0; x < source_width; ++x) {
      int target_x = 0;
      int target_y = 0;
      MapPoint(orientation, source_width, source_height, x, y, &target_x, &target_y);
      std::memcpy(result.Row(target_y) + static_cast<std::size_t>(target_x) * kChannels,
                  source_row + static_cast<std::size_t>(x) * kChannels,
                  kChannels * sizeof(std::uint16_t));
    }
  }
  return result;
}

}  // namespace photoy
