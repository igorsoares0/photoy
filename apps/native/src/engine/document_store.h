#pragma once

#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

#include "color/profile.h"
#include "decoder/decoder.h"
#include "edit/edit_stack.h"
#include "edit/render.h"
#include "decoder/exif.h"
#include "image/image_buffer.h"

namespace photoy {

/**
 * An image decoded once and held at full resolution in the working space.
 *
 * The working-space pixels stay resident so previews and exports are both
 * derived from the same decode and the same colour conversion; nothing re-reads
 * the file, and the source file itself is never written to.
 */
struct Document {
  std::string id;
  std::string path;
  std::string file_name;
  ImageFormat format = ImageFormat::kUnknown;
  /// Full resolution, upright, in the engine working space. Never modified
  /// after the decode - every edit lives in the stack below.
  Image16 source;
  /// Bits per channel in the source file, which decides the export default.
  int bit_depth = 8;
  bool has_alpha = false;
  Orientation orientation = Orientation::kTopLeft;
  std::uint64_t file_size = 0;
  /// EXIF from the source, kept so an export can carry it forward.
  ExifBlob exif;
  /// True when the file carried a usable ICC profile rather than being assumed sRGB.
  bool tagged = false;
  /// Description of the source profile, for the UI. Empty when untagged.
  std::string source_profile;

  /// Guards the stack. The pixels above need no lock: they never change after
  /// the decode, which is what lets several renders read them at once.
  mutable std::mutex stack_mutex;
  EditStack stack;

  /// A copy of the operations in effect, safe to hand to a worker.
  std::vector<Operation> ActiveOperations() const;

  /**
   * The last geometry result, kept so a moving slider does not redo it.
   *
   * Adjustments do not change shape, so while one is being dragged this stays
   * valid and the render cost stops depending on how large the file is. Held by
   * shared pointer: a render that is already reading it must not have it freed
   * underneath by the next request.
   */
  std::shared_ptr<const Image16> CachedBase(const PreviewPlan& plan) const;
  void CacheBase(const PreviewPlan& plan, std::shared_ptr<const Image16> base);

 private:
  mutable std::mutex base_mutex_;
  PreviewPlan base_plan_;
  std::shared_ptr<const Image16> base_;
};

/**
 * The open documents.
 *
 * Documents are handed out by shared pointer so a render already running keeps
 * the pixels it is reading alive even if the host closes the document mid-flight.
 */
class DocumentStore {
 public:
  /// Decodes `utf8_path` and registers the result. Throws EngineException on
  /// any read or decode failure.
  std::shared_ptr<Document> Open(const std::string& utf8_path);

  /// Throws EngineException when the id is unknown, which is always a host bug.
  std::shared_ptr<Document> Get(const std::string& id) const;

  bool Close(const std::string& id);

 private:
  mutable std::mutex mutex_;
  std::unordered_map<std::string, std::shared_ptr<Document>> documents_;
  std::uint64_t next_id_ = 1;
};

}  // namespace photoy
