#include "ai/compute.h"

#include <algorithm>
#include <mutex>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <dxgi1_4.h>
#include <wrl/client.h>
#endif

#include "core/log.h"

namespace photoy::ai {
namespace {

/**
 * Below this there is no point.
 *
 * A model and its intermediates have to fit, and a card that cannot hold them
 * spills to system memory across the bus, which is slower than not using it.
 * Two gigabytes is what the largest model here needs with room to work.
 */
constexpr std::uint64_t kMinimumVideoMemory = 2ull * 1024 * 1024 * 1024;

std::vector<ComputeDevice> Enumerate() {
  std::vector<ComputeDevice> found;
#ifdef _WIN32
  Microsoft::WRL::ComPtr<IDXGIFactory1> factory;
  if (FAILED(CreateDXGIFactory1(IID_PPV_ARGS(&factory)))) return found;

  Microsoft::WRL::ComPtr<IDXGIAdapter1> adapter;
  for (UINT i = 0; factory->EnumAdapters1(i, &adapter) != DXGI_ERROR_NOT_FOUND; ++i) {
    DXGI_ADAPTER_DESC1 description{};
    if (FAILED(adapter->GetDesc1(&description))) continue;
    // The software renderer is not a GPU, whatever it reports.
    if ((description.Flags & DXGI_ADAPTER_FLAG_SOFTWARE) != 0) continue;

    ComputeDevice device;
    device.index = static_cast<int>(i);
    device.memory = static_cast<std::uint64_t>(description.DedicatedVideoMemory);
    device.discrete = device.memory >= kMinimumVideoMemory;

    const int needed = ::WideCharToMultiByte(CP_UTF8, 0, description.Description, -1, nullptr, 0,
                                             nullptr, nullptr);
    if (needed > 1) {
      device.name.resize(static_cast<std::size_t>(needed - 1));
      ::WideCharToMultiByte(CP_UTF8, 0, description.Description, -1, device.name.data(), needed,
                            nullptr, nullptr);
    }
    found.push_back(std::move(device));
  }

  // Best first, which is what a caller taking the front of the list expects:
  // memory of its own beats none, and more of it beats less.
  std::sort(found.begin(), found.end(), [](const ComputeDevice& a, const ComputeDevice& b) {
    if (a.discrete != b.discrete) return a.discrete;
    return a.memory > b.memory;
  });
#endif
  return found;
}

}  // namespace

const char* ComputeApiName(ComputeApi api) noexcept {
  switch (api) {
    case ComputeApi::kDirectMl: return "directml";
    case ComputeApi::kCpu: break;
  }
  return "cpu";
}

const std::vector<ComputeDevice>& Devices() {
  static const std::vector<ComputeDevice> devices = [] {
    std::vector<ComputeDevice> listed = Enumerate();
    for (const ComputeDevice& device : listed) {
      log::Info("graphics adapter " + std::to_string(device.index) + " " + device.name + " " +
                std::to_string(device.memory / (1024 * 1024)) + " MB" +
                (device.discrete ? " (usable)" : " (integrated, not used)"));
    }
    return listed;
  }();
  return devices;
}

const ComputeDevice* PreferredDevice() {
  const std::vector<ComputeDevice>& devices = Devices();
  if (devices.empty() || !devices.front().discrete) return nullptr;
  return &devices.front();
}

ComputeApi RunningApi() noexcept { return ComputeApi::kCpu; }

ComputeApi PreferredApi() noexcept {
#ifdef _WIN32
  return PreferredDevice() != nullptr ? ComputeApi::kDirectMl : ComputeApi::kCpu;
#else
  return ComputeApi::kCpu;
#endif
}

}  // namespace photoy::ai
