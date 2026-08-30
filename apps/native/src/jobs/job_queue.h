#pragma once

#include <condition_variable>
#include <cstdint>
#include <deque>
#include <functional>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

#include "jobs/cancellation.h"

namespace photoy {

/**
 * Runs engine work off the thread that reads the protocol.
 *
 * Two properties matter more than throughput. Reading never blocks, so a cancel
 * that arrives while a render is running is actually seen. And a job can be
 * superseded: submitting under a coalescing key cancels the earlier job holding
 * it, which is what turns a dragged slider into one render instead of forty.
 */
class JobQueue {
 public:
  /// Receives the token it should poll; returning early on cancellation is the
  /// task's own responsibility.
  using Task = std::function<void(const CancellationTokenPtr&)>;

  explicit JobQueue(unsigned worker_count);
  ~JobQueue();

  JobQueue(const JobQueue&) = delete;
  JobQueue& operator=(const JobQueue&) = delete;

  /**
   * Queues a task under `id`.
   *
   * A non-empty `coalesce_key` cancels any earlier job carrying the same key.
   * Cancelled jobs still run: the task sees a cancelled token and reports it,
   * so every request gets exactly one response.
   */
  void Submit(std::uint64_t id, std::string coalesce_key, Task task);

  /// Cancels a job by id. Returns false when it already finished.
  bool Cancel(std::uint64_t id);

  /// Stops accepting work, cancels everything outstanding, and joins.
  void Shutdown();

 private:
  struct Entry {
    std::uint64_t id = 0;
    std::string coalesce_key;
    Task task;
    CancellationTokenPtr token;
  };

  void Work();
  /// Cancels every tracked job sharing the key. Caller holds the lock.
  void CancelKeyLocked(const std::string& key);

  std::mutex mutex_;
  std::condition_variable ready_;
  std::deque<Entry> pending_;
  /// Tokens for jobs that are queued or running, so both can be cancelled.
  std::unordered_map<std::uint64_t, CancellationTokenPtr> live_;
  std::unordered_map<std::uint64_t, std::string> keys_;
  std::vector<std::thread> workers_;
  bool stopping_ = false;
};

/// Worker count for this machine: enough to keep a render off the reader,
/// bounded because the working buffers are large and memory is the real limit.
unsigned DefaultWorkerCount() noexcept;

}  // namespace photoy
