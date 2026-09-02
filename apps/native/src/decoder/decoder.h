#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "color/profile.h"
#include "color/temperature.h"
#include "image/image_buffer.h"
#include "image/orientation.h"

namespace photoy {

enum class ImageFormat { kUnknown, kJpeg, kPng, kTiff, kWebp, kRaw, kHeif };

/// Lowercase wire name, matching the ImageFormat union in packages/types.
const char* FormatName(ImageFormat format) noexcept;

/**
 * How a raw file should be developed.
 *
 * Not an edit. Everything in the edit stack acts on pixels the decoder already
 * produced; these choose what it produces, because white balance has to happen
 * on the sensor's own numbers before the mosaic is interpolated. Changing one
 * means decoding again, which is why they travel apart from Adjustments.
 */
struct RawSettings {
  /// False leaves the camera's own white balance alone, which is what an
  /// untouched file should show.
  bool custom_balance = false;
  color::WhiteBalance balance;

  bool operator==(const RawSettings& other) const noexcept {
    return custom_balance == other.custom_balance &&
           (!custom_balance || (balance.kelvin == other.balance.kelvin &&
                                balance.tint == other.balance.tint));
  }
  bool operator!=(const RawSettings& other) const noexcept { return !(*this == other); }
};

/// What a raw file says about itself, for the UI to show and to start from.
struct RawInfo {
  /**
   * Whether temperature and tint can be offered at all.
   *
   * False for a file that carries no usable camera matrix - a linear DNG out of
   * a phone, for one, where the manufacturer already demosaiced and there is
   * nothing to map a colour temperature through. Offering a slider that cannot
   * do anything is worse than not offering it.
   */
  bool adjustable = false;
  /// The camera's own white balance, read back as a photographer would state it.
  color::WhiteBalance as_shot;
};

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
  /**
   * Whether the pixels are already in the engine's working space.
   *
   * True only for raw, where the decode chooses its own output space and there
   * is no embedded profile to honour. It saves the colour stage from running an
   * identity transform over the whole frame, which on a 24 MP file is seconds.
   */
  bool in_working_space = false;
  /// Only meaningful when the file was raw; default otherwise.
  RawInfo raw;
};

/// Each decoder receives the whole file. Milestone 1 images fit in memory
/// comfortably; streaming belongs with the tiled pipeline in milestone 4.
DecodedImage DecodeJpeg(const std::vector<std::uint8_t>& bytes);
DecodedImage DecodePng(const std::vector<std::uint8_t>& bytes);
DecodedImage DecodeTiff(const std::vector<std::uint8_t>& bytes);
DecodedImage DecodeWebp(const std::vector<std::uint8_t>& bytes);
DecodedImage DecodeRaw(const std::vector<std::uint8_t>& bytes,
                       const RawSettings& settings = {});

/**
 * HEIC, through whatever the operating system has.
 *
 * No decoder is shipped and none can be: libheif and libde265 are LGPL-3.0,
 * which does not combine with this build's static linking, and HEVC carries
 * patent terms that no licence choice answers. So the frames are handed to the
 * codec the platform provides - free on macOS, and on Windows the free HEIF
 * Image Extensions from Microsoft. Not one bit of HEVC ships in this product.
 */
DecodedImage DecodeHeif(const std::vector<std::uint8_t>& bytes);

/**
 * Whether the bytes hold raw sensor data.
 *
 * Separate from SniffFormat because it cannot be answered from a magic
 * number: most raw files are TIFF containers and share their leading bytes.
 * Answering it means parsing the header, so only Decode pays for it, and
 * only when the cheap sniff came back TIFF or unknown.
 */
bool IsRaw(const std::vector<std::uint8_t>& bytes) noexcept;

/**
 * The preview a camera wrote into its own raw file.
 *
 * Every camera stores one, because its own screen has to show something without
 * demosaicing the frame. Reading it is the difference between a folder of raw
 * files browsing at the speed of a folder of JPEGs and browsing at more than a
 * second each - so this is what a thumbnail asks for first, and a full decode
 * is the fallback when the answer is empty or too small.
 *
 * Returns an empty vector when there is no usable preview. Anything else
 * throws, because a file that cannot be opened at all is a different problem.
 */
struct RawPreviewInfo {
  /// The rotation the preview still owes, which the demosaiced frame does not.
  Orientation orientation = Orientation::kTopLeft;
  /// Size of the photograph itself, upright - not of the preview.
  int width = 0;
  int height = 0;
};

std::vector<std::uint8_t> RawPreview(const std::vector<std::uint8_t>& bytes,
                                     RawPreviewInfo* out_info);

/// Sniffs the format and dispatches. Throws EngineException on failure.
/// `settings` reaches the raw decoder and is ignored by every other one.
DecodedImage Decode(const std::vector<std::uint8_t>& bytes, ImageFormat* out_format,
                    const RawSettings& settings = {});

}  // namespace photoy
