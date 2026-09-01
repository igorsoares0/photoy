#pragma once

#include <cstdint>
#include <array>
#include <memory>
#include <mutex>
#include <string>
#include <utility>
#include <vector>

namespace photoy::ai {

/// What a model is, and whether it can be used right now.
struct ModelInfo {
  /// Stable identifier the protocol uses, e.g. "segmentation".
  std::string id;
  std::string file_name;
  /// Spelled out because it is a product constraint, not a footnote: only
  /// permissively licensed weights ship with this application.
  std::string license;
  std::string source;
  /// False when the file is not on disk. The UI explains rather than fails.
  bool available = false;
  std::uint64_t byte_size = 0;
  bool loaded = false;
};

/// An ONNX Runtime session, held behind an opaque handle.
class Session {
 public:
  Session(const std::string& path, const std::string& name);
  ~Session();

  Session(const Session&) = delete;
  Session& operator=(const Session&) = delete;

  /// Side of the square input the model expects.
  int input_side() const noexcept { return input_side_; }

  /**
   * Runs the model over a normalised NCHW tensor and returns the first output.
   *
   * The first output is the one U^2-Net calls d0; the six that follow are the
   * side outputs it was trained with and are not useful here.
   */
  std::vector<float> Run(const std::vector<float>& input);

  /**
   * Runs a model that takes several NCHW inputs, returning the first output
   * whole.
   *
   * Inputs are matched to the model by name rather than by position: LaMa
   * declares an image and a mask, and which order they come in is the model's
   * business, not the caller's.
   */
  std::vector<float> RunNamed(const std::vector<std::string>& names,
                              const std::vector<std::vector<float>>& inputs,
                              const std::vector<std::array<std::int64_t, 4>>& shapes);

  /**
   * Runs the model and returns every output, keyed by the name it declares.
   *
   * For a model whose answer is spread across several tensors rather than
   * concentrated in one: a detector reports boxes, scores and keypoints at
   * three scales, and none of the twelve is the answer on its own.
   */
  std::vector<std::pair<std::string, std::vector<float>>> RunAll(
      const std::vector<float>& input, const std::array<std::int64_t, 4>& shape);

  /// Input names the model declares, in its own order.
  const std::vector<std::string>& input_names() const noexcept { return input_names_; }

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
  int input_side_ = 320;
  std::vector<std::string> input_names_;
};

/**
 * Discovers, loads and unloads the models.
 *
 * Loading happens on demand and nothing is held speculatively: the spike in
 * `spikes/ai` measured half a gigabyte resident for the small segmentation
 * model, which is more than the working buffer of a 60-megapixel photograph.
 * Memory, not speed, is what governs this.
 */
class ModelManager {
 public:
  explicit ModelManager(std::string directory);

  const std::string& directory() const noexcept { return directory_; }

  /// Everything the build knows about, loaded or not.
  std::vector<ModelInfo> List() const;

  /// Loads the model if it is not already resident. Throws EngineException when
  /// the file is missing or the runtime refuses it.
  std::shared_ptr<Session> Acquire(const std::string& id);

  /// Releases every session. Called when the engine winds down, and available
  /// for the memory pressure handling that milestone 5 will need.
  void UnloadAll();

  /// An estimate of what loading this model will cost, for the job queue.
  static std::uint64_t MemoryEstimate(const std::string& id) noexcept;

 private:
  mutable std::mutex mutex_;
  std::string directory_;
  std::vector<ModelInfo> catalogue_;
  std::vector<std::shared_ptr<Session>> sessions_;
};

/// Where models live: PHOTOY_MODEL_DIR, else beside the executable.
std::string DefaultModelDirectory();

}  // namespace photoy::ai
