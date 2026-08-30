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

/// What the queue is currently allowed to run, and what it has run.
struct JobQueueStats {
  std::uint64_t budget_bytes = 0;
  std::uint64_t admitted_bytes = 0;
  /// High-water marks, for checking the budget is actually being respected.
  std::uint64_t peak_admitted_bytes = 0;
  unsigned peak_concurrent_jobs = 0;
  unsigned workers = 0;
};

/**
 * Runs engine work off the thread that reads the protocol.
 *
 * Three properties matter more than throughput. Reading never blocks, so a
 * cancel that arrives while a render is running is actually seen. A job can be
 * superseded: submitting under a coalescing key cancels the earlier job holding
 * it, which is what turns a dragged slider into one render instead of forty.
 *
 * And admission is governed by memory, not by a count of workers. The jobs this
 * engine runs differ by three orders of magnitude in what they allocate - a
 * preview is a few megabytes, a full-resolution export is hundreds, and an
 * inference measured near a gigabyte in `spikes/ai`. Four of the first are
 * nothing; two of the last would take the process down. Counting workers cannot
 * tell those apart; counting bytes can.
 */
class JobQueue {
 public:
  /// Receives the token it should poll; returning early on cancellation is the
  /// task's own responsibility.
  using Task = std::function<void(const CancellationTokenPtr&)>;

  JobQueue(unsigned worker_count, std::uint64_t budget_bytes);
  ~JobQueue();

  JobQueue(const JobQueue&) = delete;
  JobQueue& operator=(const JobQueue&) = delete;

  /**
   * Queues a task under `id`.
   *
   * `memory_estimate` is what the task expects to hold at its peak. It gates
   * admission, so a rough figure that errs high is worth more than a precise
   * one that errs low.
   *
   * A non-empty `coalesce_key` cancels any earlier job carrying the same key.
   * Cancelled jobs still run: the task sees a cancelled token and reports it,
   * so every request gets exactly one response.
   */
  void Submit(std::uint64_t id, std::string coalesce_key, std::uint64_t memory_estimate,
              Task task);

  /// Cancels a job by id. Returns false when it already finished.
  bool Cancel(std::uint64_t id);

  JobQueueStats Stats() const;

  /// Stops accepting work, cancels everything outstanding, and joins.
  void Shutdown();

 private:
  struct Entry {
    std::uint64_t id = 0;
    std::string coalesce_key;
    std::uint64_t memory_estimate = 0;
    Task task;
    CancellationTokenPtr token;
    /// Whether the estimate was counted against the budget when admitted.
    bool charged = false;
  };

  void Work();
  /// Cancels every tracked job sharing the key. Caller holds the lock.
  void CancelKeyLocked(const std::string& key);
  /// Removes the first pending job that may start now. Caller holds the lock.
  bool TakeRunnableLocked(Entry& entry);

  mutable std::mutex mutex_;
  std::condition_variable ready_;
  std::deque<Entry> pending_;
  /// Tokens for jobs that are queued or running, so both can be cancelled.
  std::unordered_map<std::uint64_t, CancellationTokenPtr> live_;
  std::unordered_map<std::uint64_t, std::string> keys_;
  std::vector<std::thread> workers_;

  std::uint64_t budget_bytes_ = 0;
  std::uint64_t admitted_bytes_ = 0;
  unsigned running_ = 0;
  std::uint64_t peak_admitted_bytes_ = 0;
  unsigned peak_concurrent_jobs_ = 0;
  bool stopping_ = false;
};

/// Worker count for this machine: enough to keep a render off the reader,
/// bounded because the working buffers are large.
unsigned DefaultWorkerCount() noexcept;

/**
 * How many bytes of concurrent job work this machine will allow.
 *
 * A share of physical memory, overridable with PHOTOY_JOB_MEMORY_BUDGET_MB.
 * Deliberately a share rather than a fixed number: the machines this runs on
 * differ by more than the jobs do.
 */
std::uint64_t DefaultMemoryBudget() noexcept;

}  // namespace photoy
