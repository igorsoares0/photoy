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

std::shared_ptr<const Image16> Document::CachedBase(const PreviewPlan& plan,
                                                   const RawSettings& settings) const {
  const std::lock_guard<std::mutex> lock(base_mutex_);
  if (base_ == nullptr || !plan.Matches(base_plan_) || base_settings_ != settings) return nullptr;
  return base_;
}

void Document::CacheBase(const PreviewPlan& plan, const RawSettings& settings,
                         std::shared_ptr<const Image16> base) {
  const std::lock_guard<std::mutex> lock(base_mutex_);
  base_plan_ = plan;
  base_settings_ = settings;
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

std::uint64_t Document::StorePatch(PatchBuffer buffer) {
  const std::lock_guard<std::mutex> lock(patches_mutex_);
  const std::uint64_t patch_id = next_patch_++;
  patches_[patch_id] = std::make_shared<const PatchBuffer>(std::move(buffer));
  fitted_patches_.clear();
  return patch_id;
}

void Document::RestorePatch(std::uint64_t patch_id, PatchBuffer buffer) {
  const std::lock_guard<std::mutex> lock(patches_mutex_);
  patches_[patch_id] = std::make_shared<const PatchBuffer>(std::move(buffer));
  next_patch_ = std::max(next_patch_, patch_id + 1);
  fitted_patches_.clear();
}

std::shared_ptr<const PatchBuffer> Document::FindPatch(std::uint64_t patch_id) const {
  const std::lock_guard<std::mutex> lock(patches_mutex_);
  const auto found = patches_.find(patch_id);
  return found == patches_.end() ? nullptr : found->second;
}

std::vector<std::pair<std::uint64_t, std::shared_ptr<const PatchBuffer>>> Document::AllPatches()
    const {
  const std::lock_guard<std::mutex> lock(patches_mutex_);
  return {patches_.begin(), patches_.end()};
}

std::shared_ptr<const FittedPatch> Document::CachedFittedPatch(const PreviewPlan& plan,
                                                               std::uint64_t patch_id) const {
  const std::lock_guard<std::mutex> lock(patches_mutex_);
  if (!plan.Matches(fitted_patch_plan_)) return nullptr;
  const auto found = fitted_patches_.find(patch_id);
  return found == fitted_patches_.end() ? nullptr : found->second;
}

void Document::CacheFittedPatch(const PreviewPlan& plan, std::uint64_t patch_id,
                                std::shared_ptr<const FittedPatch> fitted) {
  const std::lock_guard<std::mutex> lock(patches_mutex_);
  if (!plan.Matches(fitted_patch_plan_)) {
    fitted_patches_.clear();
    fitted_patch_plan_ = plan;
  }
  fitted_patches_[patch_id] = std::move(fitted);
}

std::shared_ptr<Document> DocumentStore::Open(const std::string& utf8_path) {
  if (!paths::Exists(utf8_path)) {
    throw EngineException(error_code::kFileNotFound, "File not found", utf8_path);
  }
  return OpenFromMemory(paths::ReadAll(utf8_path), paths::FileName(utf8_path), utf8_path);
}

std::shared_ptr<const Image16> Document::DevelopedSource(const RawSettings& settings) const {
  // An aliasing shared pointer with no owner: it points at `source`, which the
  // document owns for its whole life, and costs nothing to make. The caller
  // cannot tell this one from a decoded buffer, which is what keeps the render
  // path free of a special case for the ordinary file.
  const auto as_shot = [this] {
    return std::shared_ptr<const Image16>(std::shared_ptr<const void>(), &source);
  };

  if (!settings.custom_balance || format != ImageFormat::kRaw || !raw.adjustable) {
    return as_shot();
  }

  const std::lock_guard<std::mutex> lock(developed_mutex_);
  if (developed_ != nullptr && developed_settings_ == settings) return developed_;

  // Decoding again is the whole point, and it is not cheap - a full frame, on
  // the order of a second. It is also the only way: white balance multiplies
  // the sensor's own numbers before demosaicing, and nothing downstream of that
  // can undo the interpolation to get back to them.
  DecodedImage decoded = DecodeRaw(source_bytes, settings);
  developed_ = std::make_shared<const Image16>(std::move(decoded.pixels));
  developed_settings_ = settings;
  return developed_;
}

std::shared_ptr<Document> DocumentStore::OpenFromMemory(std::vector<std::uint8_t> bytes,
                                                        const std::string& file_name,
                                                        const std::string& origin_path) {

  ImageFormat format = ImageFormat::kUnknown;
  DecodedImage decoded = Decode(bytes, &format);

  // Colour management happens here, once, immediately after decode: everything
  // downstream works in the engine space and never has to ask what the file was.
  const color::Profile source_profile = color::Profile::FromIcc(decoded.icc);
  Image16 working = decoded.in_working_space
                        ? std::move(decoded.pixels)
                        : color::ToWorking(decoded.pixels, source_profile);

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
  document->raw = decoded.raw;
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
