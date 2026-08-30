#pragma once

#include <mutex>

#include "protocol/frame.h"

namespace photoy::protocol {

/**
 * Frame transport over the process's own stdin and stdout.
 *
 * stdout is reserved entirely for the protocol - anything else written there
 * would desynchronise the stream - so all diagnostics go to stderr.
 */
class StdioTransport {
 public:
  /// Switches the standard streams to binary mode. Required on Windows, where
  /// text mode would otherwise rewrite 0x0A bytes inside pixel payloads.
  StdioTransport();

  /// Blocks until a full frame arrives. Returns false on clean end of input.
  /// Throws EngineException when the stream is malformed.
  bool Read(Frame& frame);

  /// Writes a frame and flushes it. Safe to call from any thread: responses
  /// come from job workers, and two half-written frames would desynchronise the
  /// stream past recovery.
  void Write(const Frame& frame);

 private:
  bool ReadExact(void* target, std::size_t length);

  std::mutex write_mutex_;
};

}  // namespace photoy::protocol
