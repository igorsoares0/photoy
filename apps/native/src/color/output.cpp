#include "color/output.h"

#include <cmath>
#include <map>
#include <mutex>

namespace photoy::color {
namespace {

double EncodeLinear(const ColorSpaceDefinition& space, double value) {
  switch (space.transfer) {
    case TransferFunction::kLinear:
      return value;
    case TransferFunction::kPower:
      return std::pow(value, 1.0 / space.gamma);
    case TransferFunction::kSrgb:
      break;
  }
  return value <= 0.0031308 ? value * 12.92 : 1.055 * std::pow(value, 1.0 / 2.4) - 0.055;
}

}  // namespace

OutputConverter::OutputConverter(const ColorSpaceDefinition& target) {
  const Mat3 matrix = WorkingToLinear(target);
  for (int i = 0; i < 9; ++i) matrix_[i] = static_cast<float>(matrix.m[i]);

  // The curve is smooth, so linear interpolation between these samples lands
  // well inside 16-bit precision; without it this many points would still cost
  // about an eighth of a level near black, where sRGB is steepest.
  curve_.resize(kCurveSize);
  for (int i = 0; i < kCurveSize; ++i) {
    curve_[static_cast<std::size_t>(i)] =
        static_cast<float>(EncodeLinear(target, static_cast<double>(i) / (kCurveSize - 1)));
  }
}

const OutputConverter& ConverterFor(OutputSpace space) {
  // There are three of them and each is a few kilobytes, so they are built once
  // on first use and kept for the life of the process.
  static std::mutex mutex;
  static std::map<int, OutputConverter> cache;

  const std::lock_guard<std::mutex> lock(mutex);
  const auto found = cache.find(static_cast<int>(space));
  if (found != cache.end()) return found->second;
  return cache.emplace(static_cast<int>(space), OutputConverter(DefinitionFor(space)))
      .first->second;
}

}  // namespace photoy::color
