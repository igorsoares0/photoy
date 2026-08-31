#pragma once

#include <cstdint>
#include <string>

#include <nlohmann/json.hpp>

#include "ai/model_manager.h"
#include "engine/document_store.h"
#include "jobs/job_queue.h"
#include "protocol/frame.h"
#include "protocol/stdio_transport.h"

namespace photoy {

inline constexpr const char* kEngineName = "photoy-engine";
inline constexpr const char* kEngineVersion = "0.4.0";

/**
 * Dispatches protocol requests onto the image pipeline.
 *
 * Requests split two ways. Anything that only touches bookkeeping - describing
 * the engine, editing the stack, cancelling a job - answers on the reading
 * thread, because it is measured in microseconds and because a cancel that
 * queues behind the render it is cancelling is useless. Anything that touches
 * pixels goes to the job queue.
 */
class Engine {
 public:
  explicit Engine(protocol::StdioTransport& transport);
  ~Engine();

  /// Handles one request. Responses are written by whichever thread finishes
  /// the work, so this may return before the caller has been answered.
  void Dispatch(const nlohmann::json& header);

  /// Cancels outstanding work and waits for it to report back.
  void Shutdown();

 private:
  // Reader-thread handlers.
  nlohmann::json Describe() const;
  nlohmann::json CloseImage(const nlohmann::json& params);
  nlohmann::json ApplyEdit(const nlohmann::json& params);
  nlohmann::json UndoEdit(const nlohmann::json& params);
  nlohmann::json RedoEdit(const nlohmann::json& params);
  nlohmann::json SeekEdit(const nlohmann::json& params);
  nlohmann::json ResetEdits(const nlohmann::json& params);
  nlohmann::json EditHistory(const nlohmann::json& params);
  nlohmann::json CancelJob(const nlohmann::json& params);

  // Worker-thread handlers.
  protocol::Frame OpenImage(std::int64_t id, const nlohmann::json& params);
  protocol::Frame OpenProject(std::int64_t id, const nlohmann::json& params);
  protocol::Frame SaveProjectJob(std::int64_t id, const nlohmann::json& params);
  protocol::Frame SegmentJob(std::int64_t id, const nlohmann::json& params,
                             const CancellationTokenPtr& token);

  /// Raster masks the layers refer to, resampled to the render and cached.
  FittedMasks FitMasks(Document& document, const PreviewPlan& plan,
                       const std::vector<Layer>& layers) const;
  protocol::Frame RenderPreviewJob(std::int64_t id, const nlohmann::json& params,
                                   const CancellationTokenPtr& token);
  protocol::Frame ExportImage(std::int64_t id, const nlohmann::json& params,
                              const CancellationTokenPtr& token);

  void EmitJobState(std::int64_t id, const char* state) const;
  std::uint64_t EstimateMemory(const std::string& method, const nlohmann::json& params) const;

  protocol::StdioTransport& transport_;
  DocumentStore documents_;
  ai::ModelManager models_;
  JobQueue jobs_;
};

}  // namespace photoy
