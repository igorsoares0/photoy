#include "engine/document_store.h"

#include <algorithm>

#include "color/pipeline.h"
#include "core/error.h"
#include "core/log.h"
#include "core/paths.h"

namespace photoy {

std::vector<Operation> Document::ActiveOperations() const {
  const std::lock_guard<std::mutex> lock(stack_mutex);
  return stack.Active();
}

std::shared_ptr<const Image16> Document::CachedBase(const PreviewPlan& plan) const {
  const std::lock_guard<std::mutex> lock(base_mutex_);
  if (base_ == nullptr || !plan.Matches(base_plan_)) return nullptr;
  return base_;
}

void Document::CacheBase(const PreviewPlan& plan, std::shared_ptr<const Image16> base) {
  const std::lock_guard<std::mutex> lock(base_mutex_);
  base_plan_ = plan;
  base_ = std::move(base);
}

std::uint64_t Document::StoreMask(MaskBuffer buffer) {
  const std::lock_guard<std::mutex> lock(masks_mutex_);
  const std::uint64_t mask_id = next_mask_++;
  masks_[mask_id] = std::make_shared<const MaskBuffer>(std::move(buffer));
  fitted_.clear();
  return mask_id;
}

void Document::RestoreMask(std::uint64_t mask_id, MaskBuffer buffer) {
  const std::lock_guard<std::mutex> lock(masks_mutex_);
  masks_[mask_id] = std::make_shared<const MaskBuffer>(std::move(buffer));
  next_mask_ = std::max(next_mask_, mask_id + 1);
  fitted_.clear();
}

std::shared_ptr<const MaskBuffer> Document::FindMask(std::uint64_t mask_id) const {
  const std::lock_guard<std::mutex> lock(masks_mutex_);
  const auto found = masks_.find(mask_id);
  return found == masks_.end() ? nullptr : found->second;
}

std::vector<std::pair<std::uint64_t, std::shared_ptr<const MaskBuffer>>> Document::AllMasks()
    const {
  const std::lock_guard<std::mutex> lock(masks_mutex_);
  return {masks_.begin(), masks_.end()};
}

std::shared_ptr<const MaskBuffer> Document::CachedFittedMask(const PreviewPlan& plan,
                                                             std::uint64_t mask_id) const {
  const std::lock_guard<std::mutex> lock(masks_mutex_);
  if (!plan.Matches(fitted_plan_)) return nullptr;
  const auto found = fitted_.find(mask_id);
  return found == fitted_.end() ? nullptr : found->second;
}

void Document::CacheFittedMask(const PreviewPlan& plan, std::uint64_t mask_id,
                               std::shared_ptr<const MaskBuffer> fitted) {
  const std::lock_guard<std::mutex> lock(masks_mutex_);
  if (!plan.Matches(fitted_plan_)) {
    fitted_.clear();
    fitted_plan_ = plan;
  }
  fitted_[mask_id] = std::move(fitted);
}

std::shared_ptr<Document> DocumentStore::Open(const std::string& utf8_path) {
  if (!paths::Exists(utf8_path)) {
    throw EngineException(error_code::kFileNotFound, "File not found", utf8_path);
  }
  return OpenFromMemory(paths::ReadAll(utf8_path), paths::FileName(utf8_path), utf8_path);
}

std::shared_ptr<Document> DocumentStore::OpenFromMemory(std::vector<std::uint8_t> bytes,
                                                        const std::string& file_name,
                                                        const std::string& origin_path) {

  ImageFormat format = ImageFormat::kUnknown;
  DecodedImage decoded = Decode(bytes, &format);

  // Colour management happens here, once, immediately after decode: everything
  // downstream works in the engine space and never has to ask what the file was.
  const color::Profile source_profile = color::Profile::FromIcc(decoded.icc);
  Image16 working = color::ToWorking(decoded.pixels, source_profile);

  auto document = std::make_shared<Document>();
  {
    const std::lock_guard<std::mutex> lock(mutex_);
    document->id = "doc-" + std::to_string(next_id_++);
  }
  document->path = origin_path;
  document->file_name = file_name;
  document->format = format;
  document->bit_depth = decoded.bit_depth;
  document->has_alpha = decoded.has_alpha;
  document->orientation = decoded.orientation;
  document->file_size = static_cast<std::uint64_t>(bytes.size());
  document->source_bytes = std::move(bytes);
  document->source = std::move(working);
  document->tagged = source_profile.valid();
  document->source_profile = source_profile.valid() ? source_profile.Description() : std::string();
  if (format == ImageFormat::kJpeg) {
    document->exif = ExtractJpegExif(bytes);
    NormalizeOrientationTag(document->exif);
  }


  log::Info("opened " + document->id + " " + std::to_string(document->source.width()) + "x" +
            std::to_string(document->source.height()) + " " + FormatName(format) + " " +
            std::to_string(document->bit_depth) + "-bit " +
            (document->tagged ? document->source_profile : "untagged, assumed sRGB"));

  const std::lock_guard<std::mutex> lock(mutex_);
  documents_.emplace(document->id, document);
  return document;
}

std::shared_ptr<Document> DocumentStore::Get(const std::string& id) const {
  const std::lock_guard<std::mutex> lock(mutex_);
  const auto it = documents_.find(id);
  if (it == documents_.end()) {
    throw EngineException(error_code::kDocumentNotFound, "Document is not open", id);
  }
  return it->second;
}

bool DocumentStore::Close(const std::string& id) {
  const std::lock_guard<std::mutex> lock(mutex_);
  const bool erased = documents_.erase(id) > 0;
  if (erased) log::Info("closed " + id);
  return erased;
}

}  // namespace photoy
