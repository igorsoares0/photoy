// Espinho de inferência local. Fora do build do produto - ver README.md.
//
// Roda um modelo de segmentação sobre uma imagem RGBA crua e escreve a máscara
// resultante, medindo cada etapa. O objetivo é medir, não integrar.

#include <onnxruntime_cxx_api.h>

// windows.h precisa vir antes de psapi.h; a ordem alfabetica quebra a compilacao.
#include <windows.h>

#include <psapi.h>

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <array>
#include <fstream>
#include <string>
#include <vector>

namespace {

using Clock = std::chrono::steady_clock;

double MillisSince(Clock::time_point start) {
  return std::chrono::duration<double, std::milli>(Clock::now() - start).count();
}

double PeakWorkingSetMb() {
  PROCESS_MEMORY_COUNTERS counters{};
  if (GetProcessMemoryInfo(GetCurrentProcess(), &counters, sizeof(counters)) == 0) return 0.0;
  return static_cast<double>(counters.PeakWorkingSetSize) / (1024.0 * 1024.0);
}

std::vector<unsigned char> ReadFile(const std::string& path) {
  std::ifstream file(path, std::ios::binary);
  return std::vector<unsigned char>((std::istreambuf_iterator<char>(file)),
                                    std::istreambuf_iterator<char>());
}

/// Bilinear resize of an RGBA buffer into a planar, normalised NCHW tensor.
///
/// U^2-Net expects 320x320, scaled by the image maximum rather than by 255, then
/// standardised with the ImageNet statistics it was trained under.
std::vector<float> Preprocess(const std::vector<unsigned char>& rgba, int width, int height,
                              int side) {
  static constexpr float kMean[3] = {0.485f, 0.456f, 0.406f};
  static constexpr float kStd[3] = {0.229f, 0.224f, 0.225f};

  unsigned char maximum = 1;
  for (std::size_t i = 0; i < rgba.size(); i += 4) {
    maximum = std::max({maximum, rgba[i], rgba[i + 1], rgba[i + 2]});
  }
  const float scale = 1.0f / static_cast<float>(maximum);

  std::vector<float> tensor(static_cast<std::size_t>(3) * side * side);
  for (int y = 0; y < side; ++y) {
    const float source_y = (y + 0.5f) * height / side - 0.5f;
    const int y0 = std::clamp(static_cast<int>(source_y), 0, height - 1);
    const int y1 = std::min(y0 + 1, height - 1);
    const float fy = std::clamp(source_y - y0, 0.0f, 1.0f);

    for (int x = 0; x < side; ++x) {
      const float source_x = (x + 0.5f) * width / side - 0.5f;
      const int x0 = std::clamp(static_cast<int>(source_x), 0, width - 1);
      const int x1 = std::min(x0 + 1, width - 1);
      const float fx = std::clamp(source_x - x0, 0.0f, 1.0f);

      for (int c = 0; c < 3; ++c) {
        const auto at = [&](int px, int py) {
          return static_cast<float>(rgba[(static_cast<std::size_t>(py) * width + px) * 4 + c]);
        };
        const float top = at(x0, y0) + (at(x1, y0) - at(x0, y0)) * fx;
        const float bottom = at(x0, y1) + (at(x1, y1) - at(x0, y1)) * fx;
        const float value = (top + (bottom - top) * fy) * scale;
        tensor[(static_cast<std::size_t>(c) * side + y) * side + x] =
            (value - kMean[c]) / kStd[c];
      }
    }
  }
  return tensor;
}

/// Normalises the network output to 0-255 and scales it back to image size.
std::vector<unsigned char> Postprocess(const float* prediction, int side, int width, int height) {
  float low = prediction[0];
  float high = prediction[0];
  for (int i = 1; i < side * side; ++i) {
    low = std::min(low, prediction[i]);
    high = std::max(high, prediction[i]);
  }
  const float range = high > low ? high - low : 1.0f;

  std::vector<unsigned char> mask(static_cast<std::size_t>(width) * height);
  for (int y = 0; y < height; ++y) {
    const float source_y = (y + 0.5f) * side / height - 0.5f;
    const int y0 = std::clamp(static_cast<int>(source_y), 0, side - 1);
    const int y1 = std::min(y0 + 1, side - 1);
    const float fy = std::clamp(source_y - y0, 0.0f, 1.0f);

    for (int x = 0; x < width; ++x) {
      const float source_x = (x + 0.5f) * side / width - 0.5f;
      const int x0 = std::clamp(static_cast<int>(source_x), 0, side - 1);
      const int x1 = std::min(x0 + 1, side - 1);
      const float fx = std::clamp(source_x - x0, 0.0f, 1.0f);

      const auto at = [&](int px, int py) {
        return (prediction[static_cast<std::size_t>(py) * side + px] - low) / range;
      };
      const float top = at(x0, y0) + (at(x1, y0) - at(x0, y0)) * fx;
      const float bottom = at(x0, y1) + (at(x1, y1) - at(x0, y1)) * fx;
      const float value = std::clamp(top + (bottom - top) * fy, 0.0f, 1.0f);
      mask[static_cast<std::size_t>(y) * width + x] = static_cast<unsigned char>(value * 255.0f + 0.5f);
    }
  }
  return mask;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc < 6) {
    std::printf("uso: segment <modelo.onnx> <entrada.rgba> <largura> <altura> <saida.gray>\n");
    return 1;
  }
  const std::string model_path = argv[1];
  const std::string input_path = argv[2];
  const int width = std::atoi(argv[3]);
  const int height = std::atoi(argv[4]);
  const std::string output_path = argv[5];

  const std::vector<unsigned char> rgba = ReadFile(input_path);
  if (rgba.size() != static_cast<std::size_t>(width) * height * 4) {
    std::printf("entrada tem %zu bytes, esperava %zu\n", rgba.size(),
                static_cast<std::size_t>(width) * height * 4);
    return 1;
  }

  const double baseline_mb = PeakWorkingSetMb();
  std::printf("  imagem            %d x %d  (%.1f MP)\n", width, height, width * height / 1e6);

  Ort::Env env(ORT_LOGGING_LEVEL_WARNING, "photoy-spike");
  Ort::SessionOptions options;
  options.SetIntraOpNumThreads(0);  // let the runtime pick
  options.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_ALL);

  auto started = Clock::now();
  const std::wstring wide_model(model_path.begin(), model_path.end());
  Ort::Session session(env, wide_model.c_str(), options);
  std::printf("  carregar modelo   %8.1f ms\n", MillisSince(started));

  Ort::AllocatorWithDefaultOptions allocator;
  const auto input_name = session.GetInputNameAllocated(0, allocator);
  const auto output_name = session.GetOutputNameAllocated(0, allocator);
  const auto shape =
      session.GetInputTypeInfo(0).GetTensorTypeAndShapeInfo().GetShape();
  const int side = shape.size() == 4 && shape[2] > 0 ? static_cast<int>(shape[2]) : 320;
  std::printf("  entrada           \"%s\"  %lldx%lld   saidas: %zu\n", input_name.get(),
              shape.size() == 4 ? shape[2] : -1, shape.size() == 4 ? shape[3] : -1,
              session.GetOutputCount());

  started = Clock::now();
  std::vector<float> tensor = Preprocess(rgba, width, height, side);
  const double preprocess_ms = MillisSince(started);

  const std::array<std::int64_t, 4> input_shape{1, 3, side, side};
  auto memory = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
  const char* input_names[] = {input_name.get()};
  const char* output_names[] = {output_name.get()};

  std::vector<double> samples;
  Ort::Value result{nullptr};
  for (int run = 0; run < 5; ++run) {
    Ort::Value input = Ort::Value::CreateTensor<float>(memory, tensor.data(), tensor.size(),
                                                       input_shape.data(), input_shape.size());
    started = Clock::now();
    auto outputs = session.Run(Ort::RunOptions{nullptr}, input_names, &input, 1, output_names, 1);
    samples.push_back(MillisSince(started));
    if (run == 4) result = std::move(outputs.front());
  }
  std::sort(samples.begin(), samples.end());

  started = Clock::now();
  const std::vector<unsigned char> mask =
      Postprocess(result.GetTensorData<float>(), side, width, height);
  const double postprocess_ms = MillisSince(started);

  std::printf("  pre-processar     %8.1f ms\n", preprocess_ms);
  std::printf("  inferencia        %8.1f ms   (1a: %.1f, mediana de 5)\n", samples[2], samples.back());
  std::printf("  pos-processar     %8.1f ms\n", postprocess_ms);
  std::printf("  total por foto    %8.1f ms\n", preprocess_ms + samples[2] + postprocess_ms);
  std::printf("  pico de memoria   %8.1f MB  (linha de base %.1f MB)\n", PeakWorkingSetMb(),
              baseline_mb);

  std::ofstream out(output_path, std::ios::binary);
  out.write(reinterpret_cast<const char*>(mask.data()), static_cast<std::streamsize>(mask.size()));
  return 0;
}
