#pragma once

#include <cstdint>
#include <cstdio>
#include <memory>
#include <string>
#include <vector>

namespace photoy::paths {

/// FILE* wrapper so decoders can hand a handle to C libraries without leaking.
using FileHandle = std::unique_ptr<std::FILE, int (*)(std::FILE*)>;

/// Opens a file for binary reading. Paths are UTF-8 everywhere, including on
/// Windows, where they are widened before hitting the CRT so that accented and
/// non-Latin file names work.
FileHandle OpenRead(const std::string& utf8_path);

/// Opens a file for binary writing, creating or truncating it.
FileHandle OpenWrite(const std::string& utf8_path);

bool Exists(const std::string& utf8_path);
std::uint64_t FileSize(const std::string& utf8_path);

/// Reads a whole file into memory. Throws EngineException on failure.
std::vector<std::uint8_t> ReadAll(const std::string& utf8_path);

/// Moves `from` onto `to`, replacing it. Used to publish exports atomically so
/// a failed encode never leaves a half-written file where the old one was.
/// Not named ReplaceFile: windows.h claims that name with a macro.
void MoveReplacing(const std::string& utf8_from, const std::string& utf8_to);

void RemoveFile(const std::string& utf8_path);

/// Returns the final path component, e.g. "cove-04.jpg".
std::string FileName(const std::string& utf8_path);

/// Lowercased extension without the dot, e.g. "jpg". Empty when there is none.
std::string Extension(const std::string& utf8_path);

}  // namespace photoy::paths
