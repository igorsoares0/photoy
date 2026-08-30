#include "core/paths.h"

#include <algorithm>
#include <cctype>

#include "core/error.h"

#ifdef _WIN32
#include <windows.h>
#else
#include <sys/stat.h>
#endif

namespace photoy::paths {
namespace {

#ifdef _WIN32
std::wstring Widen(const std::string& utf8) {
  if (utf8.empty()) return {};
  const int needed = ::MultiByteToWideChar(CP_UTF8, 0, utf8.data(),
                                           static_cast<int>(utf8.size()), nullptr, 0);
  if (needed <= 0) {
    throw EngineException(error_code::kInvalidRequest, "Invalid file path",
                          "path is not valid utf-8");
  }
  std::wstring wide(static_cast<std::size_t>(needed), L'\0');
  ::MultiByteToWideChar(CP_UTF8, 0, utf8.data(), static_cast<int>(utf8.size()),
                        wide.data(), needed);
  return wide;
}
#endif

FileHandle Open(const std::string& utf8_path, const char* mode) {
#ifdef _WIN32
  const std::wstring wide_path = Widen(utf8_path);
  const std::wstring wide_mode(mode, mode + std::char_traits<char>::length(mode));
  std::FILE* file = ::_wfopen(wide_path.c_str(), wide_mode.c_str());
#else
  std::FILE* file = std::fopen(utf8_path.c_str(), mode);
#endif
  return FileHandle(file, &std::fclose);
}

}  // namespace

FileHandle OpenRead(const std::string& utf8_path) { return Open(utf8_path, "rb"); }

FileHandle OpenWrite(const std::string& utf8_path) { return Open(utf8_path, "wb"); }

bool Exists(const std::string& utf8_path) {
#ifdef _WIN32
  const DWORD attributes = ::GetFileAttributesW(Widen(utf8_path).c_str());
  return attributes != INVALID_FILE_ATTRIBUTES &&
         (attributes & FILE_ATTRIBUTE_DIRECTORY) == 0;
#else
  struct stat info {};
  return ::stat(utf8_path.c_str(), &info) == 0 && S_ISREG(info.st_mode);
#endif
}

std::uint64_t FileSize(const std::string& utf8_path) {
#ifdef _WIN32
  WIN32_FILE_ATTRIBUTE_DATA data {};
  if (::GetFileAttributesExW(Widen(utf8_path).c_str(), GetFileExInfoStandard, &data) == 0) {
    return 0;
  }
  return (static_cast<std::uint64_t>(data.nFileSizeHigh) << 32) | data.nFileSizeLow;
#else
  struct stat info {};
  if (::stat(utf8_path.c_str(), &info) != 0) return 0;
  return static_cast<std::uint64_t>(info.st_size);
#endif
}

std::vector<std::uint8_t> ReadAll(const std::string& utf8_path) {
  FileHandle file = OpenRead(utf8_path);
  if (file == nullptr) {
    throw EngineException(error_code::kFileNotFound, "Could not open file",
                          utf8_path);
  }
  if (std::fseek(file.get(), 0, SEEK_END) != 0) {
    throw EngineException(error_code::kFileUnreadable, "Could not read file",
                          utf8_path);
  }
  const long size = std::ftell(file.get());
  if (size < 0) {
    throw EngineException(error_code::kFileUnreadable, "Could not read file",
                          utf8_path);
  }
  std::rewind(file.get());

  std::vector<std::uint8_t> bytes(static_cast<std::size_t>(size));
  if (size > 0 && std::fread(bytes.data(), 1, bytes.size(), file.get()) != bytes.size()) {
    throw EngineException(error_code::kFileUnreadable, "Incomplete file read",
                          utf8_path);
  }
  return bytes;
}

void MoveReplacing(const std::string& utf8_from, const std::string& utf8_to) {
#ifdef _WIN32
  const std::wstring from = Widen(utf8_from);
  const std::wstring to = Widen(utf8_to);
  if (::MoveFileExW(from.c_str(), to.c_str(),
                    MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) == 0) {
    throw EngineException(error_code::kWriteFailed, "Could not write file",
                          "MoveFileExW error " + std::to_string(::GetLastError()));
  }
#else
  if (std::rename(utf8_from.c_str(), utf8_to.c_str()) != 0) {
    throw EngineException(error_code::kWriteFailed, "Could not write file",
                          "rename failed");
  }
#endif
}

void RemoveFile(const std::string& utf8_path) {
#ifdef _WIN32
  ::DeleteFileW(Widen(utf8_path).c_str());
#else
  std::remove(utf8_path.c_str());
#endif
}

std::string FileName(const std::string& utf8_path) {
  const std::size_t cut = utf8_path.find_last_of("/\\");
  return cut == std::string::npos ? utf8_path : utf8_path.substr(cut + 1);
}

std::string Extension(const std::string& utf8_path) {
  const std::string name = FileName(utf8_path);
  const std::size_t dot = name.find_last_of('.');
  if (dot == std::string::npos || dot + 1 >= name.size()) return {};
  std::string extension = name.substr(dot + 1);
  std::transform(extension.begin(), extension.end(), extension.begin(),
                 [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  return extension;
}

}  // namespace photoy::paths
