#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace photoy::ai {

/**
 * Where inference runs.
 *
 * The abstraction section 14 asks for. Nothing above this file names DirectX,
 * Metal or Vulkan: the engine asks for a device and gets one, or does not and
 * runs on the processor. Only `compute_dml.cpp` knows which API answered, and a
 * second platform is a second file rather than a change to any caller.
 */
enum class ComputeApi {
  kCpu,
  /// Windows. Runs on any DirectX 12 adapter, whoever made it.
  kDirectMl,
};

const char* ComputeApiName(ComputeApi api) noexcept;

/// A processor the engine could run a model on.
struct ComputeDevice {
  /// Index the execution provider knows it by.
  int index = 0;
  std::string name;
  /// Dedicated video memory in bytes. Zero for an integrated adapter, which
  /// shares the machine's.
  std::uint64_t memory = 0;
  /**
   * Whether it has memory of its own.
   *
   * The distinction that decides everything here. Measured on this machine: the
   * discrete adapter ran the segmentation model ten times faster than the
   * processor, while the integrated one ran it 1.3 times faster and spent
   * sixty-five seconds compiling shaders before it could - so using it is worse
   * than not using it, on the first run and often on every run.
   */
  bool discrete = false;
};

/**
 * Every adapter the machine offers, best first.
 *
 * Enumerated once and cached: the answer cannot change while the process runs,
 * and asking costs a COM round trip.
 */
const std::vector<ComputeDevice>& Devices();

/**
 * The device worth using, or nothing.
 *
 * Returns nothing when there is no discrete adapter, which is a deliberate
 * refusal rather than a gap: see `ComputeDevice::discrete` for the numbers.
 */
const ComputeDevice* PreferredDevice();

/// Which API `PreferredDevice` would be reached through. kCpu when there is none.
ComputeApi PreferredApi() noexcept;

/**
 * What inference actually runs on today, which is the processor.
 *
 * Deliberately not `PreferredApi()`. The DirectML path was built and measured
 * against every model this engine carries, and it does not pay for itself:
 *
 *  - segmentation goes from 303 ms to 30 ms, which is real but was never slow;
 *  - denoising goes from 50 to 12 seconds a megapixel, which is still unusable,
 *    and at 512 pixels square it exceeded Windows' two-second watchdog and hung
 *    the display driver;
 *  - inpainting does not run at all - DirectML rejects a MatMul inside the fast
 *    Fourier convolution the model is built from.
 *
 * Switching would also pin the runtime to the version the DirectML package
 * ships, which trails the one used here, and add an 18 MB library to the
 * installer. A tenth of a second on the one operation that was already fast is
 * not worth any of that.
 *
 * The abstraction stays because the seam is the point: a machine with a larger
 * card, or a runtime that grows the operators, is a change to this one function.
 */
ComputeApi RunningApi() noexcept;

}  // namespace photoy::ai
