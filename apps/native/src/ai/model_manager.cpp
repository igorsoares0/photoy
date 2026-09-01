#include "ai/model_manager.h"

#include <onnxruntime_cxx_api.h>

#include <algorithm>
#include <array>
#include <chrono>
#include <cstdlib>

#include "core/error.h"
#include "core/log.h"
#include "core/paths.h"

#ifdef _WIN32
#include <windows.h>
#endif

namespace photoy::ai {
namespace {

/**
 * The models this build knows about.
 *
 * Licences are recorded here because they are a shipping constraint. The
 * best-known background removal models - MODNet, RMBG, ISNet - carry
 * non-commercial terms and are deliberately absent.
 */
struct CatalogueEntry {
  const char* id;
  const char* file_name;
  const char* license;
  const char* source;
};

constexpr std::array<CatalogueEntry, 4> kCatalogue{{
    {"segmentation", "u2netp.onnx", "Apache-2.0", "U^2-Net"},
    // LaMa: advimman/lama is Apache-2.0 with no separate clause for the
    // weights, and OpenCV redistributes this export under the same, checked
    // against the LICENSE in their repository rather than a summary of it.
    {"inpainting", "lama.onnx", "Apache-2.0", "LaMa (big-lama)"},
    // SCUNet: cszn/SCUNet is Apache-2.0 with no separate clause for the
    // weights, and the ONNX re-export carries the same. The blind real-world
    // PSNR variant rather than the GAN one: a GAN denoiser invents plausible
    // texture, and inventing texture in a photograph is a lie.
    //
    // Its weights live in a sibling `.onnx.data`, which the runtime finds by
    // the name recorded inside the graph - which is why the file keeps the
    // name it was published under rather than a tidier one.
    {"denoise", "scunet_color_real_psnr.onnx", "Apache-2.0", "SCUNet (blind real, PSNR)"},
    // YuNet carries its own LICENSE inside the model directory of the OpenCV
    // Zoo rather than inheriting the repository's, and that file is MIT - so
    // the weights are covered and not only the code around them. Checked by
    // reading it, and the download is verified against the hash the repository
    // records for the file.
    {"face", "yunet.onnx", "MIT", "YuNet (OpenCV Zoo)"},
}};

std::wstring Widen(const std::string& utf8) {
#ifdef _WIN32
  if (utf8.empty()) return {};
  const int needed = ::MultiByteToWideChar(CP_UTF8, 0, utf8.data(),
                                           static_cast<int>(utf8.size()), nullptr, 0);
  std::wstring wide(static_cast<std::size_t>(std::max(0, needed)), L'\0');
  ::MultiByteToWideChar(CP_UTF8, 0, utf8.data(), static_cast<int>(utf8.size()), wide.data(),
                        needed);
  return wide;
#else
  return std::wstring(utf8.begin(), utf8.end());
#endif
}

}  // namespace

struct Session::Impl {
  Ort::Env env;
  Ort::SessionOptions options;
  Ort::Session session;
  Ort::AllocatorWithDefaultOptions allocator;
  std::string input_name;
  std::string output_name;
  std::vector<std::string> input_names;
  std::vector<std::string> output_names;

  Impl(const std::string& path, const std::string& name)
      // Errors only: this build of LaMa carries unused initialisers, and the
      // runtime says so once per initialiser, which buries anything real.
      : env(ORT_LOGGING_LEVEL_ERROR, name.c_str()),
        options(),
        session(nullptr) {
    options.SetIntraOpNumThreads(0);
    options.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_ALL);
#ifdef _WIN32
    session = Ort::Session(env, Widen(path).c_str(), options);
#else
    session = Ort::Session(env, path.c_str(), options);
#endif
    input_name = session.GetInputNameAllocated(0, allocator).get();
    output_name = session.GetOutputNameAllocated(0, allocator).get();
    for (std::size_t i = 0; i < session.GetInputCount(); ++i) {
      input_names.emplace_back(session.GetInputNameAllocated(i, allocator).get());
    }
    for (std::size_t i = 0; i < session.GetOutputCount(); ++i) {
      output_names.emplace_back(session.GetOutputNameAllocated(i, allocator).get());
    }
  }
};

Session::Session(const std::string& path, const std::string& name) {
  try {
    impl_ = std::make_unique<Impl>(path, name);
  } catch (const Ort::Exception& failure) {
    throw EngineException(error_code::kInternalError, "The model could not be loaded",
                          failure.what());
  }
  const auto shape = impl_->session.GetInputTypeInfo(0).GetTensorTypeAndShapeInfo().GetShape();
  if (shape.size() == 4 && shape[2] > 0) input_side_ = static_cast<int>(shape[2]);
  input_names_ = impl_->input_names;
}

Session::~Session() = default;

std::vector<float> Session::Run(const std::vector<float>& input) {
  const std::array<std::int64_t, 4> shape{1, 3, input_side_, input_side_};
  auto memory = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
  const char* input_names[] = {impl_->input_name.c_str()};
  const char* output_names[] = {impl_->output_name.c_str()};

  try {
    Ort::Value tensor = Ort::Value::CreateTensor<float>(
        memory, const_cast<float*>(input.data()), input.size(), shape.data(), shape.size());
    auto outputs =
        impl_->session.Run(Ort::RunOptions{nullptr}, input_names, &tensor, 1, output_names, 1);

    const float* values = outputs.front().GetTensorData<float>();
    const std::size_t count = static_cast<std::size_t>(input_side_) * input_side_;
    return std::vector<float>(values, values + count);
  } catch (const Ort::Exception& failure) {
    throw EngineException(error_code::kInternalError, "The model failed to run", failure.what());
  }
}

std::vector<float> Session::RunNamed(const std::vector<std::string>& names,
                                    const std::vector<std::vector<float>>& inputs,
                                    const std::vector<std::array<std::int64_t, 4>>& shapes) {
  if (names.size() != inputs.size() || names.size() != shapes.size()) {
    throw EngineException(error_code::kInternalError, "Malformed model call",
                          "inputs, names and shapes disagree");
  }
  for (const std::string& name : names) {
    if (std::find(input_names_.begin(), input_names_.end(), name) == input_names_.end()) {
      throw EngineException(error_code::kInternalError, "The model does not take that input",
                            "no input named " + name);
    }
  }

  auto memory = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
  std::vector<const char*> input_names;
  std::vector<Ort::Value> tensors;
  input_names.reserve(names.size());
  tensors.reserve(inputs.size());

  try {
    for (std::size_t i = 0; i < names.size(); ++i) {
      input_names.push_back(names[i].c_str());
      tensors.push_back(Ort::Value::CreateTensor<float>(
          memory, const_cast<float*>(inputs[i].data()), inputs[i].size(), shapes[i].data(),
          shapes[i].size()));
    }
    const char* output_names[] = {impl_->output_name.c_str()};
    auto outputs = impl_->session.Run(Ort::RunOptions{nullptr}, input_names.data(), tensors.data(),
                                      tensors.size(), output_names, 1);

    const Ort::Value& first = outputs.front();
    const std::size_t count = first.GetTensorTypeAndShapeInfo().GetElementCount();
    const float* values = first.GetTensorData<float>();
    return std::vector<float>(values, values + count);
  } catch (const Ort::Exception& failure) {
    throw EngineException(error_code::kInternalError, "The model failed to run", failure.what());
  }
}

std::vector<std::pair<std::string, std::vector<float>>> Session::RunAll(
    const std::vector<float>& input, const std::array<std::int64_t, 4>& shape) {
  auto memory = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
  try {
    Ort::Value tensor = Ort::Value::CreateTensor<float>(
        memory, const_cast<float*>(input.data()), input.size(), shape.data(), shape.size());

    std::vector<const char*> names;
    names.reserve(impl_->output_names.size());
    for (const std::string& name : impl_->output_names) names.push_back(name.c_str());

    const char* input_names[] = {impl_->input_name.c_str()};
    auto outputs = impl_->session.Run(Ort::RunOptions{nullptr}, input_names, &tensor, 1,
                                      names.data(), names.size());

    std::vector<std::pair<std::string, std::vector<float>>> result;
    result.reserve(outputs.size());
    for (std::size_t i = 0; i < outputs.size(); ++i) {
      const std::size_t count = outputs[i].GetTensorTypeAndShapeInfo().GetElementCount();
      const float* values = outputs[i].GetTensorData<float>();
      result.emplace_back(impl_->output_names[i], std::vector<float>(values, values + count));
    }
    return result;
  } catch (const Ort::Exception& failure) {
    throw EngineException(error_code::kInternalError, "The model failed to run", failure.what());
  }
}

std::string DefaultModelDirectory() {
  if (const char* configured = std::getenv("PHOTOY_MODEL_DIR")) {
    if (configured[0] != '\0') return configured;
  }
#ifdef _WIN32
  // Beside the executable, which is where a packaged build puts them.
  std::wstring buffer(1024, L'\0');
  const DWORD length = ::GetModuleFileNameW(nullptr, buffer.data(),
                                            static_cast<DWORD>(buffer.size()));
  if (length > 0) {
    std::string path(length, '\0');
    ::WideCharToMultiByte(CP_UTF8, 0, buffer.data(), static_cast<int>(length), path.data(),
                          static_cast<int>(path.size()), nullptr, nullptr);
    const std::size_t cut = path.find_last_of("\\/");
    if (cut != std::string::npos) return path.substr(0, cut) + "\\models";
  }
#endif
  return "models";
}

ModelManager::ModelManager(std::string directory) : directory_(std::move(directory)) {
  sessions_.resize(kCatalogue.size());
  for (const CatalogueEntry& entry : kCatalogue) {
    ModelInfo info;
    info.id = entry.id;
    info.file_name = entry.file_name;
    info.license = entry.license;
    info.source = entry.source;
    const std::string path = directory_ + "/" + entry.file_name;
    info.available = paths::Exists(path);
    info.byte_size = info.available ? paths::FileSize(path) : 0;
    catalogue_.push_back(std::move(info));
  }
  log::Info("models directory " + directory_);
}

std::vector<ModelInfo> ModelManager::List() const {
  const std::lock_guard<std::mutex> lock(mutex_);
  std::vector<ModelInfo> listed = catalogue_;
  for (std::size_t i = 0; i < listed.size(); ++i) {
    listed[i].loaded = sessions_[i] != nullptr;
  }
  return listed;
}

std::shared_ptr<Session> ModelManager::Acquire(const std::string& id) {
  const std::lock_guard<std::mutex> lock(mutex_);
  for (std::size_t i = 0; i < catalogue_.size(); ++i) {
    if (catalogue_[i].id != id) continue;
    if (sessions_[i] != nullptr) return sessions_[i];

    if (!catalogue_[i].available) {
      // An absent model is an explainable state, not a failure: the UI can say
      // what is missing and how large it is rather than showing an error.
      throw EngineException(error_code::kModelUnavailable, "The model is not installed",
                            directory_ + "/" + catalogue_[i].file_name);
    }
    const auto started = std::chrono::steady_clock::now();
    sessions_[i] = std::make_shared<Session>(directory_ + "/" + catalogue_[i].file_name, id);
    log::Info("loaded model " + id + " in " +
              std::to_string(std::chrono::duration<double, std::milli>(
                                 std::chrono::steady_clock::now() - started)
                                 .count()) +
              " ms");
    return sessions_[i];
  }
  throw EngineException(error_code::kInvalidRequest, "Unknown model", id);
}

void ModelManager::UnloadAll() {
  const std::lock_guard<std::mutex> lock(mutex_);
  for (std::shared_ptr<Session>& session : sessions_) session.reset();
}

std::uint64_t ModelManager::MemoryEstimate(const std::string&) noexcept {
  // Measured in spikes/ai: half a gigabyte resident for the small segmentation
  // model. Erring high here is what keeps two inferences from being admitted at
  // once on a machine that cannot hold them.
  return 900ull * 1024 * 1024;
}

}  // namespace photoy::ai
