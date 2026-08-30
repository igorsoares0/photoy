#pragma once

#include <stdexcept>
#include <string>
#include <utility>

namespace photoy {

/// Error codes shared with the host. Keep in sync with packages/types/src/error.ts.
namespace error_code {
inline constexpr const char* kInvalidRequest = "invalid_request";
inline constexpr const char* kFileNotFound = "file_not_found";
inline constexpr const char* kFileUnreadable = "file_unreadable";
inline constexpr const char* kUnsupportedFormat = "unsupported_format";
inline constexpr const char* kDecodeFailed = "decode_failed";
inline constexpr const char* kEncodeFailed = "encode_failed";
inline constexpr const char* kWriteFailed = "write_failed";
inline constexpr const char* kDocumentNotFound = "document_not_found";
inline constexpr const char* kOutOfMemory = "out_of_memory";
inline constexpr const char* kCancelled = "cancelled";
inline constexpr const char* kInternalError = "internal_error";
}  // namespace error_code

/// Thrown by engine operations and turned into an error response by the dispatcher.
class EngineException : public std::runtime_error {
 public:
  EngineException(std::string code, std::string message, std::string detail = {})
      : std::runtime_error(message),
        code_(std::move(code)),
        message_(std::move(message)),
        detail_(std::move(detail)) {}

  const std::string& code() const noexcept { return code_; }
  const std::string& message() const noexcept { return message_; }
  const std::string& detail() const noexcept { return detail_; }

 private:
  std::string code_;
  std::string message_;
  std::string detail_;
};

}  // namespace photoy
