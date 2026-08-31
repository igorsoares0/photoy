#pragma once

#include <cstdint>
#include <vector>

#include "edit/mask.h"

namespace photoy {

/**
 * A mask as an 8-bit greyscale PNG.
 *
 * Greyscale rather than the engine's usual RGBA because that is what a mask is,
 * and because a project is meant to be inspectable: opening `masks/1.png` in any
 * viewer should show the mask, not a puzzle.
 */
std::vector<std::uint8_t> EncodeMaskPng(const MaskBuffer& mask);
MaskBuffer DecodeMaskPng(const std::vector<std::uint8_t>& bytes);

}  // namespace photoy
