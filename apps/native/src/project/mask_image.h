#pragma once

#include <cstdint>
#include <vector>

#include "edit/mask.h"
#include "image/image_buffer.h"

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

/**
 * The same for a patch: what a model invented, as an ordinary 8-bit sRGB PNG.
 *
 * Colour rather than greyscale, and sRGB rather than the working space, because
 * that is exactly what the model produced - and because opening
 * `patches/1.png` in any viewer should show what was painted in, not a puzzle.
 */
std::vector<std::uint8_t> EncodePatchPng(const Image8& pixels);
Image8 DecodePatchPng(const std::vector<std::uint8_t>& bytes);

}  // namespace photoy
