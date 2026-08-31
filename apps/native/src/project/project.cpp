#include "project/project.h"

#include <zip.h>

#include <cstdio>
#include <memory>

#include <nlohmann/json.hpp>

#include "core/error.h"
#include "core/json.h"
#include "core/log.h"
#include "core/paths.h"
#include "edit/serialize.h"
#include "project/mask_image.h"

namespace photoy {
namespace {

using nlohmann::json;

constexpr const char* kManifestEntry = "manifest.json";
constexpr const char* kFormatTag = "photoy-project";

[[noreturn]] void Fail(const std::string& message, const std::string& detail) {
  throw EngineException(error_code::kWriteFailed, message, detail);
}

[[noreturn]] void FailRead(const std::string& message, const std::string& detail) {
  throw EngineException(error_code::kFileUnreadable, message, detail);
}

/// Escapes the zip path separator rules: entry names are always forward slashes.
std::string EntryFor(const std::string& file_name) { return "original/" + file_name; }

std::string MaskEntryFor(std::uint64_t id) { return "masks/" + std::to_string(id) + ".png"; }
std::string PatchEntryFor(std::uint64_t id) { return "patches/" + std::to_string(id) + ".png"; }

}  // namespace

void SaveProject(const Project& project, const std::string& utf8_path) {
  json manifest{
      {"format", kFormatTag},
      {"version", kProjectVersion},
      {"source",
       json{{"fileName", project.source.file_name},
            {"originPath", project.source.origin_path},
            {"entry", EntryFor(project.source.file_name)},
            {"byteLength", project.source.bytes.size()}}},
      {"operations", ToJson(project.operations)},
      {"cursor", project.cursor}};

  json masks = json::array();
  std::vector<std::vector<std::uint8_t>> mask_bytes;
  mask_bytes.reserve(project.masks.size());
  for (const auto& [id, buffer] : project.masks) {
    mask_bytes.push_back(EncodeMaskPng(buffer));
    masks.push_back(json{{"id", id},
                         {"entry", MaskEntryFor(id)},
                         {"width", buffer.width},
                         {"height", buffer.height}});
  }
  manifest["masks"] = std::move(masks);

  json patches = json::array();
  std::vector<std::vector<std::uint8_t>> patch_bytes;
  patch_bytes.reserve(project.patches.size());
  for (const auto& [id, buffer] : project.patches) {
    patch_bytes.push_back(EncodePatchPng(buffer.pixels));
    patches.push_back(json{{"id", id},
                           {"entry", PatchEntryFor(id)},
                           {"x", buffer.region.x},
                           {"y", buffer.region.y},
                           {"width", buffer.region.width},
                           {"height", buffer.region.height},
                           {"documentWidth", buffer.document_width},
                           {"documentHeight", buffer.document_height}});
  }
  manifest["patches"] = std::move(patches);
  const std::string manifest_text = manifest.dump(2);

  zip_error_t error;
  zip_error_init(&error);

  // Built in memory rather than at a path: libzip takes paths in the system
  // code page, which would mangle any file name outside it.
  zip_source_t* buffer = zip_source_buffer_create(nullptr, 0, 0, &error);
  if (buffer == nullptr) Fail("Could not create the project", zip_error_strerror(&error));
  zip_source_keep(buffer);

  zip_t* archive = zip_open_from_source(buffer, ZIP_TRUNCATE, &error);
  if (archive == nullptr) {
    zip_source_free(buffer);
    Fail("Could not create the project", zip_error_strerror(&error));
  }

  const auto add = [&](const std::string& name, const void* data, std::size_t length,
                       bool compress) {
    zip_source_t* entry = zip_source_buffer(archive, data, length, 0);
    if (entry == nullptr) Fail("Could not create the project", zip_strerror(archive));
    const zip_int64_t index = zip_file_add(archive, name.c_str(), entry, ZIP_FL_ENC_UTF_8);
    if (index < 0) {
      zip_source_free(entry);
      Fail("Could not create the project", zip_strerror(archive));
    }
    // Nothing here is stored compressed. The original is already a compressed
    // image, so deflating it again buys nothing; the manifest is small, and
    // leaving it readable means a broken project can still be inspected with
    // any tool that opens a zip.
    (void)compress;
    zip_set_file_compression(archive, static_cast<zip_uint64_t>(index), ZIP_CM_STORE, 0);
  };

  add(kManifestEntry, manifest_text.data(), manifest_text.size(), true);
  add(EntryFor(project.source.file_name), project.source.bytes.data(),
      project.source.bytes.size(), false);
  for (std::size_t i = 0; i < mask_bytes.size(); ++i) {
    add(MaskEntryFor(project.masks[i].first), mask_bytes[i].data(), mask_bytes[i].size(), false);
  }
  for (std::size_t i = 0; i < patch_bytes.size(); ++i) {
    add(PatchEntryFor(project.patches[i].first), patch_bytes[i].data(), patch_bytes[i].size(),
        false);
  }

  if (zip_close(archive) < 0) {
    const std::string detail = zip_strerror(archive);
    zip_discard(archive);
    zip_source_free(buffer);
    Fail("Could not write the project", detail);
  }

  // Pull the finished archive out of the in-memory source.
  if (zip_source_open(buffer) < 0) {
    zip_source_free(buffer);
    Fail("Could not write the project", "reopening the archive failed");
  }
  zip_source_seek(buffer, 0, SEEK_END);
  const zip_int64_t size = zip_source_tell(buffer);
  zip_source_seek(buffer, 0, SEEK_SET);

  std::vector<std::uint8_t> bytes(static_cast<std::size_t>(size));
  const zip_int64_t read = zip_source_read(buffer, bytes.data(), bytes.size());
  zip_source_close(buffer);
  zip_source_free(buffer);
  if (read != size) Fail("Could not write the project", "the archive was truncated");

  // Published the way an export is: through a temp file, so an interrupted save
  // never leaves a half-written project where a whole one used to be.
  const std::string temp_path = utf8_path + ".photoy-tmp";
  {
    paths::FileHandle file = paths::OpenWrite(temp_path);
    if (file == nullptr) Fail("Could not write the project", temp_path);
    const std::size_t written = std::fwrite(bytes.data(), 1, bytes.size(), file.get());
    const bool flushed = std::fflush(file.get()) == 0;
    if (written != bytes.size() || !flushed) {
      file.reset();
      paths::RemoveFile(temp_path);
      Fail("Could not write the project", "wrote " + std::to_string(written) + " of " +
                                              std::to_string(bytes.size()) + " bytes");
    }
  }
  try {
    paths::MoveReplacing(temp_path, utf8_path);
  } catch (...) {
    paths::RemoveFile(temp_path);
    throw;
  }
  log::Info("saved project " + utf8_path + " (" + std::to_string(bytes.size()) + " bytes)");
}

Project LoadProject(const std::string& utf8_path) {
  std::vector<std::uint8_t> file = paths::ReadAll(utf8_path);

  zip_error_t error;
  zip_error_init(&error);
  zip_source_t* buffer = zip_source_buffer_create(file.data(), file.size(), 0, &error);
  if (buffer == nullptr) FailRead("Could not open the project", zip_error_strerror(&error));

  // On success the archive owns the source: freeing it here as well would be a
  // double free, and the worker thread would die without ever answering.
  zip_t* archive = zip_open_from_source(buffer, ZIP_RDONLY, &error);
  if (archive == nullptr) {
    zip_source_free(buffer);
    FailRead("This is not a Photoy project", zip_error_strerror(&error));
  }

  const auto read_entry = [&](const std::string& name) {
    const zip_int64_t index = zip_name_locate(archive, name.c_str(), ZIP_FL_ENC_UTF_8);
    if (index < 0) {
      zip_discard(archive);
      FailRead("The project is incomplete", "missing " + name);
    }
    zip_stat_t stat;
    zip_stat_init(&stat);
    zip_stat_index(archive, static_cast<zip_uint64_t>(index), 0, &stat);

    std::vector<std::uint8_t> data(static_cast<std::size_t>(stat.size));
    zip_file_t* handle = zip_fopen_index(archive, static_cast<zip_uint64_t>(index), 0);
    if (handle == nullptr) {
      zip_discard(archive);
      FailRead("The project is unreadable", name);
    }
    const zip_int64_t got = zip_fread(handle, data.data(), data.size());
    zip_fclose(handle);
    if (got != static_cast<zip_int64_t>(data.size())) {
      zip_discard(archive);
      FailRead("The project is unreadable", name + " was truncated");
    }
    return data;
  };

  const std::vector<std::uint8_t> manifest_bytes = read_entry(kManifestEntry);
  const json manifest = json::parse(std::string(manifest_bytes.begin(), manifest_bytes.end()),
                                    nullptr, /*allow_exceptions=*/false);
  if (manifest.is_discarded() || manifest.value("format", std::string{}) != kFormatTag) {
    zip_discard(archive);
    FailRead("This is not a Photoy project", "the manifest is missing or malformed");
  }
  const int version = manifest.value("version", 0);
  if (version > kProjectVersion) {
    zip_discard(archive);
    // Refusing is the honest answer: opening it would drop whatever a newer
    // version recorded, and saving would then destroy it.
    throw EngineException(error_code::kUnsupportedFormat, "The project was made by a newer version",
                          "project version " + std::to_string(version));
  }

  Project project;
  const json& source = manifest.contains("source") ? manifest.at("source") : json::object();
  project.source.file_name = source.value("fileName", std::string("original"));
  project.source.origin_path = source.value("originPath", std::string{});
  project.source.bytes =
      read_entry(source.value("entry", EntryFor(project.source.file_name)));

  if (manifest.contains("masks") && manifest.at("masks").is_array()) {
    for (const json& entry : manifest.at("masks")) {
      const auto id = entry.value("id", static_cast<std::uint64_t>(0));
      if (id == 0) continue;
      project.masks.emplace_back(
          id, DecodeMaskPng(read_entry(entry.value("entry", MaskEntryFor(id)))));
    }
  }

  if (manifest.contains("patches") && manifest.at("patches").is_array()) {
    for (const json& entry : manifest.at("patches")) {
      const auto id = entry.value("id", static_cast<std::uint64_t>(0));
      if (id == 0) continue;
      PatchBuffer buffer;
      buffer.region = Rect{entry.value("x", 0), entry.value("y", 0), entry.value("width", 0),
                           entry.value("height", 0)};
      buffer.document_width = entry.value("documentWidth", 0);
      buffer.document_height = entry.value("documentHeight", 0);
      buffer.pixels = DecodePatchPng(read_entry(entry.value("entry", PatchEntryFor(id))));
      project.patches.emplace_back(id, std::move(buffer));
    }
  }


  zip_discard(archive);

  project.operations =
      OperationsFromJson(manifest.contains("operations") ? manifest.at("operations") : json::array());
  project.cursor = std::min<std::size_t>(manifest.value("cursor", project.operations.size()),
                                         project.operations.size());
  return project;
}

}  // namespace photoy
