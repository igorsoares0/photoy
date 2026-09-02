#include "engine/engine.h"

#include <algorithm>
#include <chrono>
#include <string>

#include "color/pipeline.h"
#include "core/error.h"
#include "core/log.h"
#include "core/paths.h"
#include "decoder/format_sniffer.h"
#include "core/json.h"
#include "edit/analysis.h"
#include "edit/render.h"
#include "image/resample.h"
#include "edit/serialize.h"
#include "ai/denoiser.h"
#include "ai/inpainter.h"
#include "ai/compute.h"
#include "ai/face_detector.h"
#include "ai/segmenter.h"
#include "project/project.h"
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

using json_util::OptionalInt;
using json_util::RequireInt;
using json_util::RequireString;

json DescribeModels(const ai::ModelManager& models) {
  json listed = json::array();
  for (const ai::ModelInfo& model : models.List()) {
    listed.push_back(json{{"id", model.id},
                          {"file", model.file_name},
                          {"license", model.license},
                          {"source", model.source},
                          {"available", model.available},
                          {"byteLength", model.byte_size},
                          {"loaded", model.loaded}});
  }
  return listed;
}

json DescribeLayer(const Layer& layer) {
  return json{{"id", layer.id},
              {"kind", LayerKindName(layer.kind)},
              {"visible", layer.visible},
              {"opacity", layer.opacity},
              {"blend", BlendModeName(layer.blend)},
              {"name", layer.name},
              {"fill", FillKindName(layer.fill)},
              {"color", json{{"r", layer.color.r}, {"g", layer.color.g}, {"b", layer.color.b}}},
              {"decontaminate", layer.decontaminate},
              {"blur", layer.blur},
              {"patch", layer.patch},
              {"patchWidth", layer.patch_width},
              {"patchHeight", layer.patch_height},
              {"adjustments", AdjustmentsToJson(layer.adjustments)},
              {"mask",
               json{{"kind", MaskKindName(layer.mask.kind)},
                    {"x", layer.mask.x},
                    {"y", layer.mask.y},
                    {"angle", layer.mask.angle},
                    {"radius", layer.mask.radius},
                    {"feather", layer.mask.feather},
                    {"invert", layer.mask.invert},
                    {"low", layer.mask.low},
                    {"high", layer.mask.high},
                    {"raster", layer.mask.raster},
                    {"rasterWidth", layer.mask.raster_width},
                    {"rasterHeight", layer.mask.raster_height}}}};
}

json DescribeOperation(const Operation& operation) {
  json entry = ToJson(operation);
  entry["id"] = operation.id;
  return entry;
}

/// The stack plus the size it produces, which is what the viewport needs to fit.
/**
 * The white balance in effect, and where it started.
 *
 * `custom` false means the file is showing the camera's own balance, and the
 * temperature reported is that one - so a control seeded from this sits where
 * the photograph actually is rather than at some invented default.
 */
json DescribeRawSettings(const RawSettings& settings, const RawInfo& info) {
  const color::WhiteBalance shown = settings.custom_balance ? settings.balance : info.as_shot;
  return json{{"custom", settings.custom_balance},
              {"temperature", shown.kelvin},
              {"tint", shown.tint}};
}

json DescribeHistory(const Document& document) {
  const std::lock_guard<std::mutex> lock(document.stack_mutex);
  const std::vector<Operation>& all = document.stack.All();

  json entries = json::array();
  for (const Operation& operation : all) entries.push_back(DescribeOperation(operation));

  const std::vector<Operation> active = document.stack.Active();
  const Geometry geometry =
      FoldGeometry(active, document.source.width(), document.source.height());

  // Layers are reported bottom first, the order they composite in. The panel
  // reverses them for display, because a stack reads downwards.
  json layers = json::array();
  for (const Layer& layer : FoldLayers(active)) layers.push_back(DescribeLayer(layer));

  return json{{"documentId", document.id},
              {"entries", std::move(entries)},
              {"layers", std::move(layers)},
              {"adjustments", AdjustmentsToJson(FoldAdjustments(active))},
              // Reported like the adjustments and for the same reason: the
              // controls read their position from here, so undo moves them.
              {"raw", DescribeRawSettings(FoldRawSettings(active), document.raw)},
              {"cursor", document.stack.cursor()},
              {"canUndo", document.stack.CanUndo()},
              {"canRedo", document.stack.CanRedo()},
              {"width", geometry.OutputWidth()},
              {"height", geometry.OutputHeight()},
              // The size the crop and the orientation alone produce. A raster
              // mask belongs to this, not to the output size: a resize scales
              // every pixel together and leaves the mask meaning exactly what
              // it meant, while a crop or a rotation moves them apart.
              {"naturalWidth", geometry.NaturalWidth()},
              {"naturalHeight", geometry.NaturalHeight()}};
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
            // Present only for a raw file that carries a camera matrix, which
            // is what the UI keys the temperature controls off: a file with no
            // matrix gets no sliders rather than sliders that do nothing.
            {"raw", document.format == ImageFormat::kRaw && document.raw.adjustable
                        ? json{{"adjustable", true},
                               {"asShotTemperature", document.raw.as_shot.kelvin},
                               {"asShotTint", document.raw.as_shot.tint}}
                        : json{{"adjustable", false}}},
            {"fileSize", document.file_size}}}};
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
    : transport_(transport),
      models_(ai::DefaultModelDirectory()),
      jobs_(DefaultWorkerCount(), DefaultMemoryBudget()) {}

Engine::~Engine() { Shutdown(); }

void Engine::Shutdown() {
  jobs_.Shutdown();
  // Nothing is held speculatively; the models go as soon as the work does.
  models_.UnloadAll();
}

void Engine::EmitJobState(std::int64_t id, const char* state) const {
  protocol::Frame frame;
  frame.header = json{{"type", "event"},
                      {"event", "job.state"},
                      {"data", json{{"jobId", id}, {"state", state}}}};
  transport_.Write(frame);
}

void Engine::Dispatch(const nlohmann::json& header,
                      const std::vector<std::uint8_t>& payload) {
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
    if (method == "edit.seek") return transport_.Write(MakeSuccess(id, SeekEdit(params)));
    if (method == "edit.reset") return transport_.Write(MakeSuccess(id, ResetEdits(params)));
    if (method == "edit.history") return transport_.Write(MakeSuccess(id, EditHistory(params)));
    if (method == "job.cancel") return transport_.Write(MakeSuccess(id, CancelJob(params)));
    // Storing a painted mask is a memcpy, so it answers here rather than
    // queueing behind a render the brush is waiting on.
    if (method == "mask.store") {
      return transport_.Write(MakeSuccess(id, StoreMask(params, payload)));
    }
    if (method == "mask.fetch") return transport_.Write(FetchMask(id, params));
  } catch (const EngineException& failure) {
    log::Warn(method + " failed: " + failure.code() + " " + failure.detail());
    return transport_.Write(MakeFailure(id, failure.code(), failure.message(), failure.detail()));
  } catch (const std::exception& failure) {
    log::Error(method + " threw: " + failure.what());
    return transport_.Write(
        MakeFailure(id, error_code::kInternalError, "Unexpected engine failure", failure.what()));
  }

  const bool known = method == "ai.inpaint" || method == "ai.denoise" ||
                     method == "background.load" ||
                     method == "image.analyse" || method == "image.open" ||
                     method == "image.renderPreview" ||
                     method == "image.export" || method == "project.open" ||
                     method == "project.save" || method == "ai.segment" ||
                     method == "ai.detectFaces";
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
                     } else if (method == "project.open") {
                       response = OpenProject(id, params);
                     } else if (method == "project.save") {
                       response = SaveProjectJob(id, params);
                     } else if (method == "ai.segment") {
                       response = SegmentJob(id, params, token);
                     } else if (method == "ai.detectFaces") {
                       response = DetectFacesJob(id, params, token);
                     } else if (method == "ai.inpaint") {
                       response = InpaintJob(id, params, token);
                     } else if (method == "background.load") {
                       response = LoadBackdrop(id, params, token);
                     } else if (method == "image.analyse") {
                       response = AnalyseJob(id, params, token);
                     } else if (method == "ai.denoise") {
                       response = DenoiseJob(id, params, token);
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
    if (method == "image.open" || method == "project.open") {
      return estimate::Open(paths::FileSize(RequireString(params, "path")));
    }
    const std::shared_ptr<Document> document = documents_.Get(RequireString(params, "documentId"));
    if (method == "ai.segment" || method == "ai.inpaint" || method == "ai.denoise" ||
        method == "ai.detectFaces") {
      return ai::ModelManager::MemoryEstimate(method);
    }
    if (method == "project.save") {
      // Saving holds the archive and a copy of it in memory at the same time.
      return std::max<std::uint64_t>(64ull * 1024 * 1024, document->source_bytes.size() * 3);
    }
    if (method == "image.export") {
      // The stack decides how big the export is, not the file: a resize can ask
      // for more pixels than were decoded, and sizing this from the source
      // would admit a job the machine cannot hold.
      const Geometry geometry = FoldGeometry(document->ActiveOperations(),
                                             document->source.width(), document->source.height());
      return estimate::Export(
          std::max<std::uint64_t>(document->source.width(), geometry.OutputWidth()),
          std::max<std::uint64_t>(document->source.height(), geometry.OutputHeight()));
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

nlohmann::json Engine::StoreMask(const json& params, const std::vector<std::uint8_t>& payload) {
  const std::shared_ptr<Document> document = documents_.Get(RequireString(params, "documentId"));
  const int width = OptionalInt(params, "width", 0);
  const int height = OptionalInt(params, "height", 0);
  if (width <= 0 || height <= 0) {
    throw EngineException(error_code::kInvalidRequest, "Invalid mask size",
                          std::to_string(width) + "x" + std::to_string(height));
  }
  // The header claims a size; the payload has to actually be that size, or the
  // rows would be read at the wrong offsets and the mask would shear.
  const std::size_t expected = static_cast<std::size_t>(width) * height;
  if (payload.size() != expected) {
    throw EngineException(error_code::kInvalidRequest, "Mask payload does not match its size",
                          std::to_string(payload.size()) + " bytes for " + std::to_string(expected));
  }

  MaskBuffer buffer;
  buffer.width = width;
  buffer.height = height;
  buffer.coverage = payload;
  const std::uint64_t raster = document->StoreMask(std::move(buffer));
  return json{{"documentId", document->id}, {"raster", raster},
              {"width", width}, {"height", height}};
}

protocol::Frame Engine::FetchMask(std::int64_t id, const json& params) {
  const std::shared_ptr<Document> document = documents_.Get(RequireString(params, "documentId"));
  const std::uint64_t raster = params.contains("raster") && params.at("raster").is_number_unsigned()
                                   ? params.at("raster").get<std::uint64_t>()
                                   : 0;
  const std::shared_ptr<const MaskBuffer> found = document->FindMask(raster);
  if (found == nullptr || found->empty()) {
    throw EngineException(error_code::kInvalidRequest, "No such mask",
                          "raster " + std::to_string(raster) + " is not stored on this document");
  }

  protocol::Frame frame = MakeSuccess(id, json{{"documentId", document->id},
                                               {"raster", raster},
                                               {"width", found->width},
                                               {"height", found->height}});
  frame.payload = found->coverage;
  return frame;
}

/**
 * What the machine could compute on, and what it is computing on.
 *
 * Reported because it is a product fact the host may want to show, and because
 * a support conversation about "why is this slow" is much shorter when the
 * answer is on screen.
 */
json DescribeCompute() {
  json adapters = json::array();
  for (const ai::ComputeDevice& device : ai::Devices()) {
    adapters.push_back(json{{"name", device.name},
                            {"memory", device.memory},
                            {"usable", device.discrete}});
  }
  return json{{"running", ai::ComputeApiName(ai::RunningApi())},
              {"available", ai::ComputeApiName(ai::PreferredApi())},
              {"adapters", std::move(adapters)}};
}

nlohmann::json Engine::Describe() const {
  const JobQueueStats stats = jobs_.Stats();
  return json{{"name", kEngineName},
              {"version", kEngineVersion},
              {"protocolVersion", protocol::kProtocolVersion},
              {"decodeFormats", json::array({"jpeg", "png", "tiff", "raw", "heif", "webp"})},
              {"encodeFormats", json::array({"jpeg", "png", "tiff", "webp"})},
              {"outputSpaces", json::array({"srgb", "display-p3", "adobe-rgb"})},
              // Reported rather than acted on. The engine runs inference on the
              // processor; see ai/compute.h for the measurements that say why.
              {"compute", DescribeCompute()},
              {"operations",
               json::array({"rotate", "flipHorizontal", "flipVertical", "crop", "resize", "adjust",
                            "addLayer", "removeLayer", "reorderLayer", "setLayerVisible",
                            "setLayerOpacity", "setLayerBlend", "setLayerMask",
                            "setLayerFill", "setLayerDecontaminate", "setLayerPatch",
                            "developRaw"})},
              {"layerKinds", json::array({"background", "adjustment", "matte", "patch"})},
              {"fillKinds", json::array({"transparent", "color", "blur", "image"})},
              {"blendModes",
               json::array({"normal", "multiply", "screen", "overlay", "soft-light"})},
              {"maskKinds", json::array({"none", "linear", "radial", "raster"})},
              {"models", DescribeModels(models_)},
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
  Operation operation = FromJson(params.at("operation"));

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

nlohmann::json Engine::SeekEdit(const json& params) {
  const std::shared_ptr<Document> document = documents_.Get(RequireString(params, "documentId"));
  {
    const std::lock_guard<std::mutex> lock(document->stack_mutex);
    document->stack.Seek(static_cast<std::size_t>(std::max(0, RequireInt(params, "cursor"))));
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

protocol::Frame Engine::OpenProject(std::int64_t id, const json& params) {
  const std::string path = RequireString(params, "path");
  Project project = LoadProject(path);
  const std::shared_ptr<Document> document = documents_.OpenFromMemory(
      std::move(project.source.bytes), project.source.file_name, project.source.origin_path);
  for (auto& [mask_id, buffer] : project.masks) document->RestoreMask(mask_id, std::move(buffer));
  for (auto& [patch_id, buffer] : project.patches) {
    document->RestorePatch(patch_id, std::move(buffer));
  }
  {
    const std::lock_guard<std::mutex> lock(document->stack_mutex);
    document->stack.Load(std::move(project.operations), project.cursor);
  }
  json result = DescribeDocument(*document);
  result["history"] = DescribeHistory(*document);
  result["projectPath"] = path;
  return MakeSuccess(id, std::move(result));
}

protocol::Frame Engine::SaveProjectJob(std::int64_t id, const json& params) {
  const std::shared_ptr<Document> document = documents_.Get(RequireString(params, "documentId"));
  const std::string target = RequireString(params, "path");

  Project project;
  project.source.file_name = document->file_name;
  project.source.origin_path = document->path;
  project.source.bytes = document->source_bytes;
  {
    const std::lock_guard<std::mutex> lock(document->stack_mutex);
    project.operations = document->stack.All();
    project.cursor = document->stack.cursor();
  }
  for (const auto& [patch_id, buffer] : document->AllPatches()) {
    if (buffer != nullptr) project.patches.emplace_back(patch_id, *buffer);
  }
  for (const auto& [mask_id, buffer] : document->AllMasks()) {
    if (buffer != nullptr) project.masks.emplace_back(mask_id, *buffer);
  }

  SaveProject(project, target);
  return MakeSuccess(id, json{{"path", target}, {"byteLength", paths::FileSize(target)}});
}

FittedMasks Engine::FitMasks(Document& document, const PreviewPlan& plan,
                             const std::vector<Layer>& layers) const {
  FittedMasks fitted;
  for (const Layer& layer : layers) {
    if (layer.mask.kind != MaskKind::kRaster || layer.mask.raster == 0) continue;
    // A raster made against a different crop or orientation no longer lines up
    // with the pixels underneath it. Leaving it out is the honest answer;
    // stretching it would be quietly wrong. A resize is not that case: it
    // scales everything together, and the mask is resampled to the render size
    // regardless, so it is measured against the natural size.
    if (layer.mask.raster_width != plan.geometry.NaturalWidth() ||
        layer.mask.raster_height != plan.geometry.NaturalHeight()) {
      continue;
    }
    if (fitted.count(layer.mask.raster) != 0) continue;

    std::shared_ptr<const MaskBuffer> ready =
        document.CachedFittedMask(plan, layer.mask.raster);
    if (ready == nullptr) {
      const std::shared_ptr<const MaskBuffer> full = document.FindMask(layer.mask.raster);
      if (full == nullptr) continue;
      ready = std::make_shared<const MaskBuffer>(Resize(*full, plan.width, plan.height));
      document.CacheFittedMask(plan, layer.mask.raster, ready);
    }
    fitted.emplace(layer.mask.raster, std::move(ready));
  }
  return fitted;
}

FittedPatches Engine::FitPatches(Document& document, const PreviewPlan& plan,
                                 const std::vector<Layer>& layers) const {
  FittedPatches fitted;
  for (const Layer& layer : layers) {
    const bool draws_pixels =
        layer.kind == LayerKind::kPatch || layer.fill == FillKind::kImage;
    if (!draws_pixels || layer.patch == 0) continue;
    // Same rule as a raster mask: a patch belongs to the crop and the
    // orientation it was made against, and a resize is not that case.
    if (layer.patch_width != plan.geometry.NaturalWidth() ||
        layer.patch_height != plan.geometry.NaturalHeight()) {
      continue;
    }
    if (fitted.count(layer.patch) != 0) continue;

    std::shared_ptr<const FittedPatch> ready = document.CachedFittedPatch(plan, layer.patch);
    if (ready == nullptr) {
      const std::shared_ptr<const PatchBuffer> full = document.FindPatch(layer.patch);
      if (full == nullptr) continue;
      ready = std::make_shared<const FittedPatch>(FitPatch(*full, plan.width, plan.height));
      document.CacheFittedPatch(plan, layer.patch, ready);
    }
    fitted.emplace(layer.patch, std::move(ready));
  }
  return fitted;
}

/**
 * Where the faces are, and nothing about what to do with them.
 *
 * The engine measures and the interface decides, the same split auto enhance
 * uses: this reports boxes and five points, and every portrait tool is built
 * from those by code that can be changed without a rebuild. It deliberately
 * does not produce a mask - a mask commits to what a tool is for, and eight
 * tools want eight different regions out of the same five points.
 */
protocol::Frame Engine::DetectFacesJob(std::int64_t id, const json& params,
                                       const CancellationTokenPtr& token) {
  const std::shared_ptr<Document> document = documents_.Get(RequireString(params, "documentId"));
  const std::vector<Operation> operations = document->ActiveOperations();

  // Detection runs on the document as it stands, geometry included, so the
  // coordinates line up with what is on screen rather than with the file.
  const int limit = std::max(64, OptionalInt(params, "maxSide", 2048));
  const PreviewPlan plan =
      PlanPreview(operations, document->source.width(), document->source.height(), limit, limit);
  const std::shared_ptr<const Image16> developed =
      document->DevelopedSource(FoldRawSettings(operations));
  const Image16 rendered = RenderGeometry(*developed, plan, token);

  const std::shared_ptr<ai::Session> session = models_.Acquire("face");
  const std::vector<ai::Face> faces = ai::DetectFaces(rendered, *session, token);

  json listed = json::array();
  for (const ai::Face& face : faces) {
    const auto point = [](const ai::Face::Point& p) {
      return json{{"x", p.x}, {"y", p.y}};
    };
    listed.push_back(json{{"x", face.x},
                          {"y", face.y},
                          {"width", face.width},
                          {"height", face.height},
                          {"score", face.score},
                          {"rightEye", point(face.right_eye)},
                          {"leftEye", point(face.left_eye)},
                          {"nose", point(face.nose)},
                          {"rightMouth", point(face.right_mouth)},
                          {"leftMouth", point(face.left_mouth)}});
  }
  log::Info("detected " + std::to_string(faces.size()) + " face(s) in " + document->id);

  return MakeSuccess(id, json{{"documentId", document->id}, {"faces", std::move(listed)}});
}

protocol::Frame Engine::SegmentJob(std::int64_t id, const json& params,
                                   const CancellationTokenPtr& token) {
  const std::shared_ptr<Document> document = documents_.Get(RequireString(params, "documentId"));
  const std::vector<Operation> operations = document->ActiveOperations();

  // Segmentation runs on the document as it stands, geometry included, so the
  // mask lines up with what is on screen rather than with the untouched file.
  const PreviewPlan plan = PlanPreview(operations, document->source.width(),
                                       document->source.height(), document->source.width(),
                                       document->source.height());
  const std::shared_ptr<const Image16> developed =
      document->DevelopedSource(FoldRawSettings(operations));
  const Image16 rendered = RenderGeometry(*developed, plan, token);

  const std::shared_ptr<ai::Session> session = models_.Acquire("segmentation");
  MaskBuffer mask = ai::Segment(rendered, *session, token);

  const std::uint64_t raster = document->StoreMask(std::move(mask));
  log::Info("segmented " + document->id + " into mask " + std::to_string(raster));

  // Reported as the natural size, which is what the mask is tied to: a later
  // resize must not make it look stale.
  return MakeSuccess(id, json{{"documentId", document->id},
                              {"raster", raster},
                              {"width", plan.geometry.NaturalWidth()},
                              {"height", plan.geometry.NaturalHeight()}});
}

/**
 * SCUNet denoising, which nothing in the interface reaches.
 *
 * Measured at roughly fifty-three seconds a megapixel on this machine's CPU -
 * ten minutes for a phone photograph - so it is not something to offer. The
 * cost is linear in pixels, so tiling would change the memory and not the wait.
 *
 * Kept rather than deleted because none of it is wrong: the licence is checked,
 * the graph takes any size, and the conversion either way is right. The day
 * inference runs on the GPU this becomes the better denoiser and the guided
 * filter in `edit/detail.cpp` stays as the one that works everywhere. The model
 * is deliberately absent from `setup-windows.bat`: seventy megabytes for
 * something unreachable is not a download to make people wait for.
 */
protocol::Frame Engine::DenoiseJob(std::int64_t id, const json& params,
                                   const CancellationTokenPtr& token) {
  const std::shared_ptr<Document> document = documents_.Get(RequireString(params, "documentId"));
  const std::vector<Operation> operations = document->ActiveOperations();

  const int limit = std::max(64, OptionalInt(params, "maxSide", 4096));
  const PreviewPlan plan =
      PlanPreview(operations, document->source.width(), document->source.height(), limit, limit);
  const std::shared_ptr<const Image16> developed =
      document->DevelopedSource(FoldRawSettings(operations));
  const Image16 base = RenderGeometry(*developed, plan, token);

  const std::shared_ptr<ai::Session> session = models_.Acquire("denoise");
  const auto started = std::chrono::steady_clock::now();
  const Image16 cleaned = ai::Denoise(base, *session, token);
  const double elapsed =
      std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count();
  log::Info("denoised " + std::to_string(cleaned.width()) + "x" + std::to_string(cleaned.height()) +
            " in " + std::to_string(elapsed) + " ms");

  PatchBuffer stored;
  stored.region = Rect{0, 0, plan.geometry.NaturalWidth(), plan.geometry.NaturalHeight()};
  stored.document_width = plan.geometry.NaturalWidth();
  stored.document_height = plan.geometry.NaturalHeight();
  stored.pixels = color::ToOutput8(cleaned, color::OutputSpace::kSrgb, token);
  const std::uint64_t identifier = document->StorePatch(std::move(stored));

  return MakeSuccess(id, json{{"documentId", document->id},
                              {"patch", identifier},
                              {"patchWidth", plan.geometry.NaturalWidth()},
                              {"patchHeight", plan.geometry.NaturalHeight()},
                              {"renderedWidth", cleaned.width()},
                              {"renderedHeight", cleaned.height()},
                              {"milliseconds", elapsed}});
}

protocol::Frame Engine::AnalyseJob(std::int64_t id, const json& params,
                                   const CancellationTokenPtr& token) {
  const std::shared_ptr<Document> document = documents_.Get(RequireString(params, "documentId"));
  const std::vector<Operation> operations = document->ActiveOperations();

  // Measured small. A histogram of a million pixels says the same thing as a
  // histogram of twenty-four million about how a photograph is exposed, and
  // this runs while somebody is waiting for an answer.
  constexpr int kAnalysisSide = 1024;
  const PreviewPlan plan = PlanPreview(operations, document->source.width(),
                                       document->source.height(), kAnalysisSide, kAnalysisSide);
  const std::shared_ptr<const Image16> developed =
      document->DevelopedSource(FoldRawSettings(operations));
  const Image16 base = RenderGeometry(*developed, plan, token);
  const std::vector<Layer> layers = FoldLayers(operations);
  const Image8 encoded =
      ComposeToOutput8(base, layers, FitMasks(*document, plan, layers),
                       FitPatches(*document, plan, layers), color::OutputSpace::kSrgb, token,
                       true, plan.scale);

  const Analysis analysis = Analyse(encoded);
  json histogram = json::array();
  for (const std::uint32_t bin : analysis.histogram) histogram.push_back(bin);

  return MakeSuccess(id, json{{"documentId", document->id},
                              {"pixels", analysis.pixels},
                              {"histogram", std::move(histogram)},
                              {"channelMean", json::array({analysis.channel_mean[0],
                                                           analysis.channel_mean[1],
                                                           analysis.channel_mean[2]})},
                              {"chromaMean", analysis.chroma_mean},
                              {"detail", analysis.detail}});
}

protocol::Frame Engine::LoadBackdrop(std::int64_t id, const json& params,
                                     const CancellationTokenPtr& token) {
  const std::shared_ptr<Document> document = documents_.Get(RequireString(params, "documentId"));
  const std::string path = RequireString(params, "path");

  std::vector<std::uint8_t> bytes = paths::ReadAll(path);
  ImageFormat format = ImageFormat::kUnknown;
  DecodedImage decoded = Decode(bytes, &format);
  const Image16 working = decoded.in_working_space
                              ? std::move(decoded.pixels)
                              : color::ToWorking(decoded.pixels, color::Profile::FromIcc(decoded.icc));

  const Geometry geometry = FoldGeometry(document->ActiveOperations(), document->source.width(),
                                         document->source.height());
  const int frame_width = geometry.NaturalWidth();
  const int frame_height = geometry.NaturalHeight();
  if (frame_width <= 0 || frame_height <= 0 || working.empty()) {
    throw EngineException(error_code::kInvalidRequest, "Nothing to place",
                          "the document or the backdrop is empty");
  }

  // Cropped to the document's shape and then scaled to fill it, so a backdrop
  // covers the frame without being stretched out of proportion. Stored at the
  // model of a patch: capped in size, because a backdrop is behind a subject
  // and detail there is not what anyone is looking at.
  constexpr int kMaxBackdrop = 2048;
  const double frame_aspect = static_cast<double>(frame_width) / frame_height;
  const double source_aspect = static_cast<double>(working.width()) / working.height();
  Rect crop{0, 0, working.width(), working.height()};
  if (source_aspect > frame_aspect) {
    crop.width = std::max(1, static_cast<int>(std::lround(working.height() * frame_aspect)));
    crop.x = (working.width() - crop.width) / 2;
  } else if (source_aspect < frame_aspect) {
    crop.height = std::max(1, static_cast<int>(std::lround(working.width() / frame_aspect)));
    crop.y = (working.height() - crop.height) / 2;
  }

  const int longest = std::max(frame_width, frame_height);
  const double scale = std::min(1.0, static_cast<double>(kMaxBackdrop) / longest);
  const int target_width = std::max(1, static_cast<int>(std::lround(frame_width * scale)));
  const int target_height = std::max(1, static_cast<int>(std::lround(frame_height * scale)));
  const Image16 placed = ResampleTo(working, crop, target_width, target_height, token);

  PatchBuffer backdrop;
  backdrop.region = Rect{0, 0, frame_width, frame_height};
  backdrop.document_width = frame_width;
  backdrop.document_height = frame_height;
  backdrop.pixels = color::ToOutput8(placed, color::OutputSpace::kSrgb, token);
  const std::uint64_t identifier = document->StorePatch(std::move(backdrop));

  return MakeSuccess(id, json{{"documentId", document->id},
                              {"patch", identifier},
                              {"patchWidth", frame_width},
                              {"patchHeight", frame_height}});
}

protocol::Frame Engine::InpaintJob(std::int64_t id, const json& params,
                                   const CancellationTokenPtr& token) {
  const std::shared_ptr<Document> document = documents_.Get(RequireString(params, "documentId"));
  const std::uint64_t raster = params.contains("raster") && params.at("raster").is_number_unsigned()
                                   ? params.at("raster").get<std::uint64_t>()
                                   : 0;
  const std::shared_ptr<const MaskBuffer> mask = document->FindMask(raster);
  if (mask == nullptr || mask->empty()) {
    throw EngineException(error_code::kInvalidRequest, "No such mask",
                          "raster " + std::to_string(raster) + " is not stored on this document");
  }

  // Inpainting works on the document as it stands, geometry included, so what
  // it fills lines up with what is on screen rather than with the decoded file.
  const std::vector<Operation> operations = document->ActiveOperations();
  const PreviewPlan plan = PlanPreview(operations, document->source.width(),
                                       document->source.height(), document->source.width(),
                                       document->source.height());
  const std::shared_ptr<const Image16> developed =
      document->DevelopedSource(FoldRawSettings(operations));
  const Image16 rendered = RenderGeometry(*developed, plan, token);

  const std::shared_ptr<ai::Session> session = models_.Acquire("inpainting");
  const ai::Patch patch = ai::Inpaint(rendered, *mask, *session, token);
  log::Info("inpainted " + document->id + " over " + std::to_string(patch.region.width) + "x" +
            std::to_string(patch.region.height));

  PatchBuffer stored;
  stored.region = patch.region;
  stored.document_width = plan.geometry.NaturalWidth();
  stored.document_height = plan.geometry.NaturalHeight();
  stored.pixels = std::move(patch.pixels);
  const int patch_width = stored.pixels.width();
  const int patch_height = stored.pixels.height();
  const std::uint64_t identifier = document->StorePatch(std::move(stored));

  return MakeSuccess(id, json{{"documentId", document->id},
                              {"patch", identifier},
                              {"x", patch.region.x},
                              {"y", patch.region.y},
                              {"width", patch.region.width},
                              {"height", patch.region.height},
                              {"patchWidth", patch_width},
                              {"patchHeight", patch_height},
                              {"documentWidth", plan.geometry.NaturalWidth()},
                              {"documentHeight", plan.geometry.NaturalHeight()}});
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
  const RawSettings settings = FoldRawSettings(operations);
  std::shared_ptr<const Image16> base = document->CachedBase(plan, settings);
  const bool reused = base != nullptr;
  if (!reused) {
    const std::shared_ptr<const Image16> developed = document->DevelopedSource(settings);
    base = std::make_shared<const Image16>(RenderGeometry(*developed, plan, token));
    document->CacheBase(plan, settings, base);
  }

  // The comparison view: the photograph with its framing but nothing done to
  // it. Framing rather than the raw file, so what moves between the two is the
  // edit being judged and not the shape of the picture.
  const std::vector<Layer> layers =
      params.value("baseline", false) ? std::vector<Layer>{} : FoldLayers(operations);
  Image8 pixels = ComposeToOutput8(*base, layers, FitMasks(*document, plan, layers),
                                   FitPatches(*document, plan, layers), color::OutputSpace::kSrgb,
                                   token, false, plan.scale);

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
  options.layers = FoldLayers(operations);

  // Masks and patches are looked up by pixel, so they have to arrive at the
  // size being rendered. A painted mask is stored at up to 2048 on its long
  // side and a patch at the model's own resolution, so neither is already
  // there: handing them over unresampled would read the rows at the wrong
  // offsets and put the mask somewhere else entirely.
  const Geometry geometry =
      FoldGeometry(operations, document->source.width(), document->source.height());
  const int output_width = geometry.OutputWidth();
  const int output_height = geometry.OutputHeight();
  for (const Layer& layer : options.layers) {
    if (layer.mask.kind == MaskKind::kRaster && layer.mask.raster != 0 &&
        layer.mask.raster_width == geometry.NaturalWidth() &&
        layer.mask.raster_height == geometry.NaturalHeight() &&
        options.masks.count(layer.mask.raster) == 0) {
      const std::shared_ptr<const MaskBuffer> full = document->FindMask(layer.mask.raster);
      if (full != nullptr) {
        options.masks.emplace(layer.mask.raster, std::make_shared<const MaskBuffer>(
                                                     Resize(*full, output_width, output_height)));
      }
    }
    if ((layer.kind == LayerKind::kPatch || layer.fill == FillKind::kImage) && layer.patch != 0 &&
        layer.patch_width == geometry.NaturalWidth() &&
        layer.patch_height == geometry.NaturalHeight() && options.patches.count(layer.patch) == 0) {
      const std::shared_ptr<const PatchBuffer> full = document->FindPatch(layer.patch);
      if (full != nullptr) {
        options.patches.emplace(layer.patch, std::make_shared<const FittedPatch>(
                                                 FitPatch(*full, output_width, output_height)));
      }
    }
  }

  const auto started = std::chrono::steady_clock::now();
  // Export renders the same stack the preview does, only at full resolution.
  const std::shared_ptr<const Image16> developed =
      document->DevelopedSource(FoldRawSettings(operations));
  const Image16 rendered = RenderFull(*developed, operations, token);
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
