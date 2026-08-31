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
#include "edit/mask.h"
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
  /**
   * The file's own bytes.
   *
   * Kept so that saving a project can embed the original without going back to
   * disk - the file may have been moved, renamed or deleted since. The cost is
   * small next to the working buffer, which is already eight bytes a pixel.
   */
  std::vector<std::uint8_t> source_bytes;
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

  /**
   * Generated masks, in document coordinates at the size they were made for.
   *
   * Kept beside the document rather than inside the operation list, because
   * they are pixels: the list stays small enough to be the project file, and
   * the buffers go into the container's own `masks/` directory.
   */
  std::uint64_t StoreMask(MaskBuffer buffer);
  std::shared_ptr<const MaskBuffer> FindMask(std::uint64_t mask_id) const;
  /// Restores a mask under a known identifier, as when a project is opened.
  void RestoreMask(std::uint64_t mask_id, MaskBuffer buffer);
  std::vector<std::pair<std::uint64_t, std::shared_ptr<const MaskBuffer>>> AllMasks() const;

  /// The same mask resampled to a render's size, kept so a slider does not
  /// resample it once a frame.
  std::shared_ptr<const MaskBuffer> CachedFittedMask(const PreviewPlan& plan,
                                                     std::uint64_t mask_id) const;
  void CacheFittedMask(const PreviewPlan& plan, std::uint64_t mask_id,
                       std::shared_ptr<const MaskBuffer> fitted);

 private:
  mutable std::mutex base_mutex_;
  PreviewPlan base_plan_;
  std::shared_ptr<const Image16> base_;

  mutable std::mutex masks_mutex_;
  std::unordered_map<std::uint64_t, std::shared_ptr<const MaskBuffer>> masks_;
  std::uint64_t next_mask_ = 1;
  PreviewPlan fitted_plan_;
  std::unordered_map<std::uint64_t, std::shared_ptr<const MaskBuffer>> fitted_;
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

  /// Registers a document from bytes already in hand, as when a project is
  /// opened and the original comes out of the container rather than the disk.
  std::shared_ptr<Document> OpenFromMemory(std::vector<std::uint8_t> bytes,
                                           const std::string& file_name,
                                           const std::string& origin_path);

  /// Throws EngineException when the id is unknown, which is always a host bug.
  std::shared_ptr<Document> Get(const std::string& id) const;

  bool Close(const std::string& id);

 private:
  mutable std::mutex mutex_;
  std::unordered_map<std::string, std::shared_ptr<Document>> documents_;
  std::uint64_t next_id_ = 1;
};

}  // namespace photoy
