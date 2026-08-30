#include "engine/engine.h"

#include <algorithm>
#include <chrono>
#include <string>

#include "color/pipeline.h"
#include "core/error.h"
#include "core/log.h"
#include "core/paths.h"
#include "decoder/format_sniffer.h"
#include "edit/render.h"
#include "export/encoder.h"

namespace photoy {
namespace {

using nlohmann::json;

protocol::Frame MakeSuccess(std::int64_t id, json result, std::vector<std::uint8_t> payload = {}) {
  protocol::Frame frame;
  frame.header = json{{"type", "response"}, {"id", id}, {"ok", true}, {"result", std::move(result)}};
  frame.payload = std::move(payload);
  return frame;
}

protocol::Frame MakeFailure(std::int64_t id, const std::string& code, const std::string& message,
                            const std::string& detail) {
  protocol::Frame frame;
  json error{{"code", code}, {"message", message}};
  if (!detail.empty()) error["detail"] = detail;
  frame.header = json{{"type", "response"}, {"id", id}, {"ok", false}, {"error", std::move(error)}};
  return frame;
}

/// Reads a required string field, failing with a precise message when missing.
std::string RequireString(const json& params, const char* key) {
  if (!params.is_object() || !params.contains(key) || !params.at(key).is_string()) {
    throw EngineException(error_code::kInvalidRequest, "Missing request parameter",
                          std::string("expected string \"") + key + "\"");
  }
  return params.at(key).get<std::string>();
}

int RequireInt(const json& params, const char* key) {
  if (!params.is_object() || !params.contains(key) || !params.at(key).is_number_integer()) {
    throw EngineException(error_code::kInvalidRequest, "Missing request parameter",
                          std::string("expected integer \"") + key + "\"");
  }
  return params.at(key).get<int>();
}

int OptionalInt(const json& params, const char* key, int fallback) {
  if (!params.is_object() || !params.contains(key) || !params.at(key).is_number()) return fallback;
  return params.at(key).get<int>();
}

json DescribeRect(const Rect& rect) {
  return json{{"x", rect.x}, {"y", rect.y}, {"width", rect.width}, {"height", rect.height}};
}

json DescribeAdjustments(const Adjustments& a) {
  return json{{"exposure", a.exposure},     {"brightness", a.brightness},
              {"contrast", a.contrast},     {"highlights", a.highlights},
              {"shadows", a.shadows},       {"saturation", a.saturation},
              {"temperature", a.temperature}};
}

json DescribeOperation(const Operation& operation) {
  json entry{{"id", operation.id}, {"kind", operation.KindName()}};
  if (operation.kind == OperationKind::kRotate) entry["quarters"] = operation.quarters;
  if (operation.kind == OperationKind::kCrop) entry["rect"] = DescribeRect(operation.rect);
  if (operation.kind == OperationKind::kAdjust) {
    entry["adjustments"] = DescribeAdjustments(operation.adjustments);
  }
  return entry;
}

/// The stack plus the size it produces, which is what the viewport needs to fit.
json DescribeHistory(const Document& document) {
  const std::lock_guard<std::mutex> lock(document.stack_mutex);
  const std::vector<Operation>& all = document.stack.All();

  json entries = json::array();
  for (const Operation& operation : all) entries.push_back(DescribeOperation(operation));

  const std::vector<Operation> active = document.stack.Active();
  const Geometry geometry =
      FoldGeometry(active, document.source.width(), document.source.height());

  return json{{"documentId", document.id},
              {"entries", std::move(entries)},
              {"adjustments", DescribeAdjustments(FoldAdjustments(active))},
              {"cursor", document.stack.cursor()},
              {"canUndo", document.stack.CanUndo()},
              {"canRedo", document.stack.CanRedo()},
              {"width", geometry.OutputWidth()},
              {"height", geometry.OutputHeight()}};
}

json DescribeDocument(const Document& document) {
  const Geometry geometry = FoldGeometry(document.ActiveOperations(), document.source.width(),
                                         document.source.height());
  return json{
      {"id", document.id},
      {"image",
       json{{"path", document.path},
            {"fileName", document.file_name},
            {"format", FormatName(document.format)},
            // The natural size of the file, before anything in the stack.
            {"sourceWidth", document.source.width()},
            {"sourceHeight", document.source.height()},
            // What the edit stack currently produces, which is what is on screen.
            {"width", geometry.OutputWidth()},
            {"height", geometry.OutputHeight()},
            {"bitDepth", document.bit_depth},
            {"hasAlpha", document.has_alpha},
            {"orientation", static_cast<int>(document.orientation)},
            {"tagged", document.tagged},
            {"sourceProfile", document.source_profile},
            {"fileSize", document.file_size}}}};
}

Operation ParseOperation(const json& params) {
  const std::string kind = RequireString(params, "kind");
  Operation operation;

  if (kind == "rotate") {
    operation.kind = OperationKind::kRotate;
    const int quarters = ((OptionalInt(params, "quarters", 1) % 4) + 4) % 4;
    if (quarters == 0) {
      throw EngineException(error_code::kInvalidRequest, "Rotation would do nothing",
                            "quarters must not be a multiple of four");
    }
    operation.quarters = quarters;
    return operation;
  }
  if (kind == "flipHorizontal") {
    operation.kind = OperationKind::kFlipHorizontal;
    return operation;
  }
  if (kind == "flipVertical") {
    operation.kind = OperationKind::kFlipVertical;
    return operation;
  }
  if (kind == "adjust") {
    operation.kind = OperationKind::kAdjust;
    const json& values =
        params.contains("adjustments") && params.at("adjustments").is_object()
            ? params.at("adjustments")
            : json::object();
    const auto read = [&values](const char* key) {
      return values.contains(key) && values.at(key).is_number()
                 ? values.at(key).get<float>()
                 : 0.0f;
    };
    operation.adjustments.exposure = std::clamp(read("exposure"), -5.0f, 5.0f);
    operation.adjustments.brightness = std::clamp(read("brightness"), -100.0f, 100.0f);
    operation.adjustments.contrast = std::clamp(read("contrast"), -100.0f, 100.0f);
    operation.adjustments.highlights = std::clamp(read("highlights"), -100.0f, 100.0f);
    operation.adjustments.shadows = std::clamp(read("shadows"), -100.0f, 100.0f);
    operation.adjustments.saturation = std::clamp(read("saturation"), -100.0f, 100.0f);
    operation.adjustments.temperature = std::clamp(read("temperature"), -100.0f, 100.0f);
    return operation;
  }
  if (kind == "crop") {
    operation.kind = OperationKind::kCrop;
    if (!params.contains("rect") || !params.at("rect").is_object()) {
      throw EngineException(error_code::kInvalidRequest, "Missing request parameter",
                            "crop needs a rect");
    }
    const json& rect = params.at("rect");
    operation.rect = {RequireInt(rect, "x"), RequireInt(rect, "y"), RequireInt(rect, "width"),
                      RequireInt(rect, "height")};
    if (operation.rect.empty()) {
      throw EngineException(error_code::kInvalidRequest, "Crop rectangle is empty",
                            "width and height must both be positive");
    }
    return operation;
  }
  throw EngineException(error_code::kInvalidRequest, "Unknown operation", kind);
}

/**
 * What a job expects to hold at its peak.
 *
 * Erring high is the cheap mistake: a job that overstates waits a little longer
 * for its turn, while one that understates gets admitted alongside another and
 * the process runs out of memory.
 */
namespace estimate {

/// Working buffers are 16-bit RGBA; output buffers are 8-bit.
constexpr std::uint64_t kWorkingBytesPerPixel = 8;
constexpr std::uint64_t kOutputBytesPerPixel = 4;

std::uint64_t Pixels(std::uint64_t width, std::uint64_t height) { return width * height; }

/**
 * Opening cannot be measured before the header is read, so this is a guess from
 * the file size with a floor under it. Compression ratios vary by an order of
 * magnitude between a flat PNG and a dense JPEG; the multiplier assumes the
 * dense end.
 */
std::uint64_t Open(std::uint64_t file_size) {
  return std::max<std::uint64_t>(256ull * 1024 * 1024, file_size * 24);
}

/// A preview holds the geometry result, an intermediate, and the output.
std::uint64_t Preview(std::uint64_t width, std::uint64_t height) {
  return Pixels(width, height) * (2 * kWorkingBytesPerPixel + kOutputBytesPerPixel);
}

/// An export holds the full-resolution render, the converted output, and the
/// encoded bytes before they reach the disk.
std::uint64_t Export(std::uint64_t width, std::uint64_t height) {
  return Pixels(width, height) *
         (kWorkingBytesPerPixel + 2 * kOutputBytesPerPixel + kOutputBytesPerPixel);
}

}  // namespace estimate

}  // namespace

Engine::Engine(protocol::StdioTransport& transport)
    : transport_(transport), jobs_(DefaultWorkerCount(), DefaultMemoryBudget()) {}

Engine::~Engine() { Shutdown(); }

void Engine::Shutdown() { jobs_.Shutdown(); }

void Engine::EmitJobState(std::int64_t id, const char* state) const {
  protocol::Frame frame;
  frame.header = json{{"type", "event"},
                      {"event", "job.state"},
                      {"data", json{{"jobId", id}, {"state", state}}}};
  transport_.Write(frame);
}

void Engine::Dispatch(const nlohmann::json& header) {
  const std::int64_t id = header.value("id", static_cast<std::int64_t>(0));
  const std::string method = header.value("method", std::string{});
  const json params = header.contains("params") ? header.at("params") : json::object();
  const std::string coalesce_key = header.value("coalesceKey", std::string{});

  // Bookkeeping answers here, on the reading thread. Putting a cancel behind
  // the render it cancels would defeat the point of having a queue at all.
  try {
    if (method == "engine.describe") return transport_.Write(MakeSuccess(id, Describe()));
    if (method == "image.close") return transport_.Write(MakeSuccess(id, CloseImage(params)));
    if (method == "edit.apply") return transport_.Write(MakeSuccess(id, ApplyEdit(params)));
    if (method == "edit.undo") return transport_.Write(MakeSuccess(id, UndoEdit(params)));
    if (method == "edit.redo") return transport_.Write(MakeSuccess(id, RedoEdit(params)));
    if (method == "edit.reset") return transport_.Write(MakeSuccess(id, ResetEdits(params)));
    if (method == "edit.history") return transport_.Write(MakeSuccess(id, EditHistory(params)));
    if (method == "job.cancel") return transport_.Write(MakeSuccess(id, CancelJob(params)));
  } catch (const EngineException& failure) {
    log::Warn(method + " failed: " + failure.code() + " " + failure.detail());
    return transport_.Write(MakeFailure(id, failure.code(), failure.message(), failure.detail()));
  } catch (const std::exception& failure) {
    log::Error(method + " threw: " + failure.what());
    return transport_.Write(
        MakeFailure(id, error_code::kInternalError, "Unexpected engine failure", failure.what()));
  }

  const bool known = method == "image.open" || method == "image.renderPreview" ||
                     method == "image.export";
  if (!known) {
    return transport_.Write(MakeFailure(id, error_code::kInvalidRequest, "Unknown method", method));
  }

  jobs_.Submit(static_cast<std::uint64_t>(id), coalesce_key, EstimateMemory(method, params),
               [this, id, method, params](const CancellationTokenPtr& token) {
                 protocol::Frame response;
                 try {
                   if (token->cancelled()) {
                     response = MakeFailure(id, error_code::kCancelled, "Operation cancelled",
                                            "superseded before it started");
                   } else {
                     EmitJobState(id, "running");
                     if (method == "image.open") {
                       response = OpenImage(id, params);
                     } else if (method == "image.renderPreview") {
                       response = RenderPreviewJob(id, params, token);
                     } else {
                       response = ExportImage(id, params, token);
                     }
                   }
                 } catch (const EngineException& failure) {
                   if (failure.code() != error_code::kCancelled) {
                     log::Warn(method + " failed: " + failure.code() + " " + failure.detail());
                   }
                   response =
                       MakeFailure(id, failure.code(), failure.message(), failure.detail());
                 } catch (const std::exception& failure) {
                   log::Error(method + " threw: " + failure.what());
                   response = MakeFailure(id, error_code::kInternalError,
                                          "Unexpected engine failure", failure.what());
                 }

                 const bool ok = response.header.value("ok", false);
                 const std::string code =
                     ok ? "" : response.header["error"].value("code", std::string{});
                 EmitJobState(id, ok ? "completed"
                                     : (code == error_code::kCancelled ? "cancelled" : "failed"));
                 transport_.Write(response);
               });
}

/**
 * Sizes a job before it is queued.
 *
 * Done here rather than inside the queue because only this layer knows how big
 * the document is, and the answer differs by three orders of magnitude between
 * a preview and an inference.
 */
std::uint64_t Engine::EstimateMemory(const std::string& method, const nlohmann::json& params) const {
  try {
    if (method == "image.open") {
      const std::string path = RequireString(params, "path");
      return estimate::Open(paths::FileSize(path));
    }
    const std::shared_ptr<Document> document = documents_.Get(RequireString(params, "documentId"));
    if (method == "image.export") {
      return estimate::Export(static_cast<std::uint64_t>(document->source.width()),
                              static_cast<std::uint64_t>(document->source.height()));
    }
    const auto width = static_cast<std::uint64_t>(
        OptionalInt(params, "maxWidth", document->source.width()));
    const auto height = static_cast<std::uint64_t>(
        OptionalInt(params, "maxHeight", document->source.height()));
    return estimate::Preview(width, height);
  } catch (const std::exception&) {
    // A request that cannot be sized is a request that is about to fail with a
    // proper error; let it through rather than block the queue on it.
    return 0;
  }
}

nlohmann::json Engine::Describe() const {
  const JobQueueStats stats = jobs_.Stats();
  return json{{"name", kEngineName},
              {"version", kEngineVersion},
              {"protocolVersion", protocol::kProtocolVersion},
              {"decodeFormats", json::array({"jpeg", "png", "tiff", "webp"})},
              {"encodeFormats", json::array({"jpeg", "png", "tiff", "webp"})},
              {"outputSpaces", json::array({"srgb", "display-p3", "adobe-rgb"})},
              {"operations",
               json::array({"rotate", "flipHorizontal", "flipVertical", "crop", "adjust"})},
              {"workingSpace", "linear-prophoto-16"},
              {"jobs",
               json{{"workers", stats.workers},
                    {"budgetBytes", stats.budget_bytes},
                    {"admittedBytes", stats.admitted_bytes},
                    {"peakAdmittedBytes", stats.peak_admitted_bytes},
                    {"peakConcurrentJobs", stats.peak_concurrent_jobs}}}};
}

nlohmann::json Engine::CloseImage(const json& params) {
  return json{{"closed", documents_.Close(RequireString(params, "documentId"))}};
}

nlohmann::json Engine::ApplyEdit(const json& params) {
  const std::shared_ptr<Document> document = documents_.Get(RequireString(params, "documentId"));
  if (!params.contains("operation") || !params.at("operation").is_object()) {
    throw EngineException(error_code::kInvalidRequest, "Missing request parameter",
                          "expected object \"operation\"");
  }
  Operation operation = ParseOperation(params.at("operation"));

  {
    const std::lock_guard<std::mutex> lock(document->stack_mutex);
    // Validated against the stack as it stands, so an impossible crop is
    // refused instead of silently emptying the document.
    std::vector<Operation> candidate = document->stack.Active();
    candidate.push_back(operation);
    const Geometry geometry =
        FoldGeometry(candidate, document->source.width(), document->source.height());
    if (geometry.source_rect.empty()) {
      throw EngineException(error_code::kInvalidRequest, "The crop falls outside the image",
                            "nothing would be left to render");
    }
    document->stack.Apply(std::move(operation), params.value("replaceTop", false));
  }
  return DescribeHistory(*document);
}

nlohmann::json Engine::UndoEdit(const json& params) {
  const std::shared_ptr<Document> document = documents_.Get(RequireString(params, "documentId"));
  {
    const std::lock_guard<std::mutex> lock(document->stack_mutex);
    document->stack.Undo();
  }
  return DescribeHistory(*document);
}

nlohmann::json Engine::RedoEdit(const json& params) {
  const std::shared_ptr<Document> document = documents_.Get(RequireString(params, "documentId"));
  {
    const std::lock_guard<std::mutex> lock(document->stack_mutex);
    document->stack.Redo();
  }
  return DescribeHistory(*document);
}

nlohmann::json Engine::ResetEdits(const json& params) {
  const std::shared_ptr<Document> document = documents_.Get(RequireString(params, "documentId"));
  {
    const std::lock_guard<std::mutex> lock(document->stack_mutex);
    document->stack.Clear();
  }
  return DescribeHistory(*document);
}

nlohmann::json Engine::EditHistory(const json& params) {
  return DescribeHistory(*documents_.Get(RequireString(params, "documentId")));
}

nlohmann::json Engine::CancelJob(const json& params) {
  const auto job_id = static_cast<std::uint64_t>(RequireInt(params, "jobId"));
  return json{{"cancelled", jobs_.Cancel(job_id)}};
}

protocol::Frame Engine::OpenImage(std::int64_t id, const json& params) {
  const std::shared_ptr<Document> document = documents_.Open(RequireString(params, "path"));
  return MakeSuccess(id, DescribeDocument(*document));
}

protocol::Frame Engine::RenderPreviewJob(std::int64_t id, const json& params,
                                         const CancellationTokenPtr& token) {
  const std::shared_ptr<Document> document = documents_.Get(RequireString(params, "documentId"));

  // The stack is snapshotted here rather than inside the render so the result
  // reflects the document as it was when the request was made.
  const std::vector<Operation> operations = document->ActiveOperations();
  const int max_width = OptionalInt(params, "maxWidth", document->source.width());
  const int max_height = OptionalInt(params, "maxHeight", document->source.height());

  const auto render_started = std::chrono::steady_clock::now();
  const PreviewPlan plan = PlanPreview(operations, document->source.width(),
                                       document->source.height(), max_width, max_height);

  // The geometry half is the expensive one and the half a slider does not
  // change, so it is reused whenever the shape of the document has not moved.
  std::shared_ptr<const Image16> base = document->CachedBase(plan);
  const bool reused = base != nullptr;
  if (!reused) {
    base = std::make_shared<const Image16>(RenderGeometry(document->source, plan, token));
    document->CacheBase(plan, base);
  }

  Image8 pixels = RenderOutput(*base, FoldAdjustments(operations), color::OutputSpace::kSrgb,
                               token);

  if (log::Enabled(log::Level::kDebug)) {
    const double elapsed = std::chrono::duration<double, std::milli>(
                               std::chrono::steady_clock::now() - render_started)
                               .count();
    log::Debug("render " + std::to_string(pixels.width()) + "x" + std::to_string(pixels.height()) +
               (reused ? " (cached geometry) in " : " in ") + std::to_string(elapsed) + " ms");
  }

  json result{{"documentId", document->id},
              {"width", pixels.width()},
              {"height", pixels.height()},
              {"stride", pixels.stride()},
              {"format", "rgba8"},
              {"colorSpace", "srgb"},
              {"documentWidth", plan.document_width},
              {"documentHeight", plan.document_height},
              {"scale", plan.scale}};
  return MakeSuccess(id, std::move(result), pixels.TakeBytes());
}

protocol::Frame Engine::ExportImage(std::int64_t id, const json& params,
                                    const CancellationTokenPtr& token) {
  const std::shared_ptr<Document> document = documents_.Get(RequireString(params, "documentId"));
  const std::string target_path = RequireString(params, "path");

  EncodeOptions options;
  options.format = FormatFromName(params.value("format", std::string{}));
  if (options.format == ImageFormat::kUnknown) {
    options.format = FormatFromName(paths::Extension(target_path));
  }
  if (options.format == ImageFormat::kUnknown) {
    throw EngineException(error_code::kUnsupportedFormat, "Unsupported export format",
                          "neither the format field nor the extension named a known format");
  }

  options.quality = std::min(100, std::max(1, OptionalInt(params, "quality", 90)));
  options.space = color::OutputSpaceFromName(params.value("colorSpace", std::string("srgb")));
  // Sixteen bits are only worth writing when the source actually had them.
  options.prefer_sixteen_bit = params.value("sixteenBit", document->bit_depth > 8);
  if (params.value("preserveMetadata", true)) options.exif = document->exif;
  options.icc = color::Profile::ForOutput(options.space).Serialize();

  const std::vector<Operation> operations = document->ActiveOperations();
  options.adjustments = FoldAdjustments(operations);

  const auto started = std::chrono::steady_clock::now();
  // Export renders the same stack the preview does, only at full resolution.
  const Image16 rendered = RenderFull(document->source, operations, token);
  EncodeToFile(rendered, options, target_path, token);
  const double duration_ms =
      std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count();

  log::Info("exported " + document->id + " to " + target_path);
  return MakeSuccess(id, json{{"path", target_path},
                              {"format", FormatName(options.format)},
                              {"colorSpace", color::OutputSpaceName(options.space)},
                              {"bitDepth", options.prefer_sixteen_bit &&
                                                   (options.format == ImageFormat::kPng ||
                                                    options.format == ImageFormat::kTiff)
                                               ? 16
                                               : 8},
                              {"width", rendered.width()},
                              {"height", rendered.height()},
                              {"bytesWritten", paths::FileSize(target_path)},
                              {"durationMs", duration_ms}});
}

}  // namespace photoy
