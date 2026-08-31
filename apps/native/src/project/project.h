#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "edit/operation.h"

namespace photoy {

/// The file a project was made from, carried inside the project itself.
struct ProjectSource {
  std::string file_name;
  /// Where the file came from. Informational: the bytes below are the truth.
  std::string origin_path;
  std::vector<std::uint8_t> bytes;
};

/**
 * A project.
 *
 * The whole edit is the operation list, so this is all there is to persist.
 * Identifiers are assigned when the list is replayed rather than stored, which
 * is what keeps the file this small and this hard to get out of sync.
 *
 * The redo tail is kept as well, so closing and reopening does not silently
 * throw away what an undo had set aside.
 */
struct Project {
  ProjectSource source;
  std::vector<Operation> operations;
  /// How many operations are in effect. Entries past this are redoable.
  std::size_t cursor = 0;
};

/// Current on-disk version. Bumped when the layout changes incompatibly.
inline constexpr int kProjectVersion = 1;

/**
 * Writes a project.
 *
 * The container is a plain zip, which is deliberate: if this application ever
 * fails to open one, the original photograph is still one double-click away.
 * The archive is built in memory and published through the same atomic write
 * an export uses, so an interrupted save cannot destroy the previous file.
 */
void SaveProject(const Project& project, const std::string& utf8_path);

/// Reads a project. Throws EngineException when it is not one, or is too new.
Project LoadProject(const std::string& utf8_path);

}  // namespace photoy
