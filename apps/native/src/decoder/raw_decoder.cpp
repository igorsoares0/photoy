#include <algorithm>
#include <cmath>
#include <cstring>
#include <string>
#include <vector>

#include <libraw/libraw.h>

#include "color/matrix.h"
#include "color/temperature.h"
#include "color/primaries.h"
#include "color/profile.h"
#include "core/error.h"
#include "decoder/decoder.h"

namespace photoy {
namespace {

/**
 * Owns the LibRaw handle so that every exit path recycles it.
 *
 * LibRaw holds a decoded frame worth tens of megabytes; leaking one per failed
 * open would be the kind of slow leak that only shows up after a long session.
 */
class RawHandle {
 public:
  RawHandle() = default;
  ~RawHandle() { processor_.recycle(); }

  RawHandle(const RawHandle&) = delete;
  RawHandle& operator=(const RawHandle&) = delete;

  LibRaw* operator->() noexcept { return &processor_; }
  LibRaw& get() noexcept { return processor_; }

 private:
  LibRaw processor_;
};

/// LibRaw reports read errors by printing to stderr, the way libtiff does.
/// Silenced for the same reason: a broken file should produce one clean error
/// through our own channel, not a line of someone else's diagnostics beside it.
void SilenceDataErrors(void*, const char*, INT64) {}

/// Turns a LibRaw status into our exception, keeping the library's own wording
/// as the detail so a bug report says which stage refused the file.
[[noreturn]] void Fail(int status, const char* stage) {
  throw EngineException(error_code::kDecodeFailed, "Could not decode RAW",
                        std::string(stage) + ": " + libraw_strerror(status));
}

/// Whether a matrix has anything in it and can be inverted, which is what
/// asking "what temperature is this" requires.
bool Usable(const color::Mat3& matrix) {
  double sum = 0.0;
  for (const double value : matrix.m) sum += std::abs(value);
  if (sum < 1.0e-6) return false;
  try {
    (void)color::Invert(matrix);
  } catch (...) {
    return false;
  }
  return true;
}

/**
 * How much a DNG calibration illuminant is worth preferring.
 *
 * The EXIF light source codes, of which only a few appear in practice. Daylight
 * wins because most photographs are nearer daylight than tungsten, and the
 * error from using one matrix grows with the distance from the light it was
 * measured under.
 */
int IlluminantPreference(int illuminant) {
  switch (illuminant) {
    case 21: return 4;  // D65
    case 23: return 3;  // D50
    case 20: return 3;  // D55
    case 22: return 3;  // D75
    case 1: return 2;   // daylight
    case 4: return 1;   // flash
    case 17: return 0;  // standard illuminant A, tungsten
    default: break;
  }
  return illuminant == 65535 ? -1 : 0;
}

/**
 * The camera's response to CIE XYZ, as a matrix we can invert.
 *
 * Two places carry it. LibRaw fills `cam_xyz` from its own table of cameras it
 * recognises, which covers every proprietary raw format. A DNG from a camera
 * not in that table leaves it empty and puts the matrix in `dng_color` instead,
 * where the file itself declared it - that is the case for a phone's DNG and
 * for any camera newer than the table.
 *
 * A DNG may declare two, measured under different lights, and the fully correct
 * answer interpolates between them at the temperature being asked about. This
 * takes the one measured nearest daylight instead, and the simplification is
 * not small: on a phone's DNG carrying both, the same file reads 5463 K through
 * the daylight matrix and 4521 K through the tungsten one.
 *
 * What that costs is the accuracy of the number on screen, not the picture. The
 * untouched file is developed by LibRaw's own camera balance and never goes
 * through this at all; once a temperature is set, the same matrix converts in
 * both directions, so setting the temperature the panel reported reproduces
 * exactly what the camera gave. Only the kelvin printed beside the slider is
 * approximate, and it is approximate in the direction of daylight, which is
 * where most photographs are.
 */
bool CameraMatrix(const LibRaw& raw, color::Mat3* out) {
  color::Mat3 candidate;
  for (int row = 0; row < 3; ++row) {
    for (int column = 0; column < 3; ++column) {
      candidate.At(row, column) = raw.imgdata.color.cam_xyz[row][column];
    }
  }
  if (Usable(candidate)) {
    *out = candidate;
    return true;
  }

  int best = -2;
  bool found = false;
  for (const auto& entry : raw.imgdata.color.dng_color) {
    color::Mat3 matrix;
    for (int row = 0; row < 3; ++row) {
      for (int column = 0; column < 3; ++column) {
        matrix.At(row, column) = entry.colormatrix[row][column];
      }
    }
    if (!Usable(matrix)) continue;
    const int preference = IlluminantPreference(entry.illuminant);
    if (preference > best) {
      best = preference;
      *out = matrix;
      found = true;
    }
  }
  return found;
}

/**
 * The camera's own multipliers, normalised so green is one.
 *
 * They arrive in whatever units the maker used - Nikon writes them around one,
 * Canon around a thousand - so the normalisation is what makes them comparable
 * and is also the form the white-balance maths expects.
 */
color::Multipliers CameraMultipliers(const LibRaw& raw) {
  const float* mul = raw.imgdata.color.cam_mul;
  if (mul[1] <= 0.0f) return {};
  return {static_cast<double>(mul[0]) / mul[1], 1.0, static_cast<double>(mul[2]) / mul[1]};
}

/**
 * LibRaw's flip code as an orientation.
 *
 * The embedded preview is stored the way the sensor read it, so unlike the
 * demosaiced frame - which LibRaw rotates itself - it still owes the rotation
 * the camera recorded. The codes are dcraw's, not EXIF's, and the mapping is
 * not the identity: 3 is a half turn and 5 and 6 are the two quarter turns.
 */
Orientation OrientationFromFlip(int flip) noexcept {
  switch (flip) {
    case 3: return Orientation::kBottomRight;  // 180 degrees
    case 5: return Orientation::kLeftBottom;   // 90 degrees anticlockwise
    case 6: return Orientation::kRightTop;     // 90 degrees clockwise
    default: return Orientation::kTopLeft;
  }
}

}  // namespace

bool IsRaw(const std::vector<std::uint8_t>& bytes) noexcept {
  // Most RAW files are TIFF containers, so their leading bytes are
  // indistinguishable from a plain TIFF. Rather than guess from makernotes,
  // ask the library that will have to decode it: open_buffer parses the header
  // and rejects anything it does not recognise as raw sensor data.
  if (bytes.empty()) return false;
  RawHandle raw;
  raw->set_dataerror_handler(&SilenceDataErrors, nullptr);
  const int status = raw->open_buffer(const_cast<std::uint8_t*>(bytes.data()), bytes.size());
  if (status != LIBRAW_SUCCESS) return false;
  // A DNG can wrap an already-demosaiced image, and open_buffer accepts it.
  // Those are ordinary TIFFs as far as we are concerned.
  return raw->imgdata.idata.raw_count > 0;
}

std::vector<std::uint8_t> RawPreview(const std::vector<std::uint8_t>& bytes,
                                     RawPreviewInfo* out_info) {
  RawHandle raw;
  raw->set_dataerror_handler(SilenceDataErrors, nullptr);

  int status = raw->open_buffer(const_cast<std::uint8_t*>(bytes.data()), bytes.size());
  if (status != LIBRAW_SUCCESS) Fail(status, "open_buffer");
  if (out_info != nullptr) {
    out_info->orientation = OrientationFromFlip(raw->imgdata.sizes.flip);
    // The visible area, which is smaller than the sensor: a raw frame carries a
    // margin the manufacturer masks off. Reported upright, because the size a
    // person means is the size of the photograph they would see.
    const int width = raw->imgdata.sizes.width;
    const int height = raw->imgdata.sizes.height;
    const bool swapped = SwapsAxes(out_info->orientation);
    out_info->width = swapped ? height : width;
    out_info->height = swapped ? width : height;
  }

  status = raw->unpack_thumb();
  // A file with no preview is not a broken file: it is a file to decode the
  // long way, so the empty answer travels back rather than an exception.
  if (status != LIBRAW_SUCCESS) return {};

  const libraw_thumbnail_t& thumb = raw->imgdata.thumbnail;
  // Only the JPEG form is taken. The bitmap forms are rare, and handing them
  // back would mean this function returning two different kinds of thing.
  if (thumb.tformat != LIBRAW_THUMBNAIL_JPEG || thumb.thumb == nullptr || thumb.tlength == 0) {
    return {};
  }
  const auto* first = reinterpret_cast<const std::uint8_t*>(thumb.thumb);
  return std::vector<std::uint8_t>(first, first + thumb.tlength);
}

DecodedImage DecodeRaw(const std::vector<std::uint8_t>& bytes, const RawSettings& settings) {
  RawHandle raw;
  raw->set_dataerror_handler(&SilenceDataErrors, nullptr);

  int status = raw->open_buffer(const_cast<std::uint8_t*>(bytes.data()), bytes.size());
  if (status != LIBRAW_SUCCESS) Fail(status, "open_buffer");

  libraw_output_params_t& params = raw->imgdata.params;

  RawInfo info;
  color::Mat3 camera_from_xyz;
  info.adjustable = CameraMatrix(raw.get(), &camera_from_xyz);
  if (info.adjustable) {
    info.as_shot = color::BalanceFrom(camera_from_xyz, CameraMultipliers(raw.get()));
  }

  // The camera's own white balance by default, which is what the photographer
  // saw on the back of the camera and what an untouched file should show.
  params.use_camera_wb = 1;
  params.use_auto_wb = 0;

  if (settings.custom_balance && info.adjustable) {
    // use_camera_wb has to go: LibRaw copies user_mul into pre_mul first and
    // then overwrites it with the camera's own values if this is still set.
    const color::Multipliers wanted =
        color::MultipliersFor(camera_from_xyz, settings.balance);
    params.use_camera_wb = 0;
    params.user_mul[0] = static_cast<float>(wanted.r);
    params.user_mul[1] = static_cast<float>(wanted.g);
    params.user_mul[2] = static_cast<float>(wanted.b);
    // The fourth channel is a second green on the sensors that have one, and
    // zero here means "same as the first green", which is what we want.
    params.user_mul[3] = 0.0f;
  }

  // Linear light on ProPhoto primaries, sixteen bits: the engine's working
  // space exactly. Anything narrower would clip camera gamut on the way in,
  // which is the one thing a raw decode must never do.
  params.output_color = 4;  // ProPhoto (ROMM)
  params.output_bps = 16;
  params.gamm[0] = 1.0;
  params.gamm[1] = 1.0;

  // Auto brightening is a taste decision, and taste lives in the edit stack.
  // Left on, it would silently bake an exposure change into every file and
  // make two shots of the same scene disagree.
  params.no_auto_bright = 1;

  /*
   * Highlights clipped, which is the brightness people expect and not a free
   * choice.
   *
   * LibRaw's highlight mode is tied to how it normalises exposure, not only to
   * what happens at the ceiling: `if (!highlight) dmax = dmin`. At zero the
   * white-balance multipliers are scaled by the smallest of them, so every
   * channel is multiplied up and the strongest clips. At anything else they are
   * scaled by the largest, nothing clips, and the whole photograph comes out
   * darker by the ratio between them - measured at 2.12x on a Nikon Z 6, over a
   * stop.
   *
   * So recovering highlights is not a parameter. It needs somewhere to put the
   * values that sit above white, and the working buffer is unsigned 16-bit with
   * its ceiling exactly there. Doing it properly means headroom above white in
   * the working space, which is a change to what a pixel means rather than a
   * setting. Until then the highlights adjustment works on what survived, and
   * that is stated here rather than hidden behind a hopeful default.
   */
  params.highlight = 0;

  if (raw->imgdata.idata.filters == LIBRAW_XTRANS) {
    // X-Trans tiles 6x6 instead of Bayer's 2x2 and its demosaic costs three
    // times as much. LibRaw runs Markesteijn in three passes above quality 2
    // and one below, and the difference was measured on two X-Trans frames of
    // opposite character: 40% of the time for a mean difference of 0.04% of
    // full scale, indistinguishable at 100% in the worst block of either. The
    // detail energy falls by 0.6%, which is the direction that rules out
    // artefacts - a maze would raise it, not lower it.
    params.user_qual = 2;
  }

  status = raw->unpack();
  if (status != LIBRAW_SUCCESS) Fail(status, "unpack");

  status = raw->dcraw_process();
  if (status != LIBRAW_SUCCESS) Fail(status, "dcraw_process");

  int width = 0;
  int height = 0;
  int colors = 0;
  int bits = 0;
  raw->get_mem_image_format(&width, &height, &colors, &bits);
  if (width <= 0 || height <= 0 || colors < 3 || bits != 16) {
    throw EngineException(error_code::kDecodeFailed, "Could not decode RAW",
                          "unexpected output format " + std::to_string(width) + "x" +
                              std::to_string(height) + " " + std::to_string(colors) + "ch " +
                              std::to_string(bits) + "bit");
  }

  Image16 pixels = Image16::Create(width, height);

  // copy_mem_image writes interleaved samples in the layout LibRaw just
  // reported, which is tightly packed and channel-count wide - never our four.
  const std::size_t source_stride = static_cast<std::size_t>(width) * colors;
  std::vector<std::uint16_t> frame(source_stride * static_cast<std::size_t>(height));
  status = raw->copy_mem_image(frame.data(), static_cast<int>(source_stride * sizeof(std::uint16_t)),
                               /*bgr=*/0);
  if (status != LIBRAW_SUCCESS) Fail(status, "copy_mem_image");

  for (int y = 0; y < height; ++y) {
    const std::uint16_t* source = frame.data() + static_cast<std::size_t>(y) * source_stride;
    std::uint16_t* target = pixels.Row(y);
    for (int x = 0; x < width; ++x) {
      const std::uint16_t* in = source + static_cast<std::size_t>(x) * colors;
      std::uint16_t* out = target + static_cast<std::size_t>(x) * kChannels;
      out[0] = in[0];
      out[1] = in[1];
      out[2] = in[2];
      out[3] = Image16::kMaxValue;  // a sensor records no transparency
    }
  }

  DecodedImage decoded;
  decoded.pixels = std::move(pixels);
  // Tagged as the working space rather than left untagged: the pixels really
  // are linear ProPhoto by the time they get here, so the colour stage has
  // nothing left to do and an untagged buffer would be read as sRGB.
  decoded.icc = color::Profile::Working().Serialize();
  decoded.in_working_space = true;
  decoded.raw = info;
  decoded.bit_depth = 16;
  decoded.has_alpha = false;
  // LibRaw applies the camera's rotation while demosaicing, so the frame it
  // hands back is already upright.
  decoded.orientation = Orientation::kTopLeft;
  return decoded;
}

}  // namespace photoy
