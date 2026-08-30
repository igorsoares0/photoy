#include "jobs/job_queue.h"

#include <algorithm>
#include <cstdlib>
#include <utility>

#include "core/log.h"

#ifdef _WIN32
#include <windows.h>
#else
#include <unistd.h>
#endif

namespace photoy {
namespace {

/// Share of physical memory the queue will commit to running jobs. The rest is
/// left for the documents held resident, the renderer, and the operating system.
constexpr double kBudgetShare = 0.35;
constexpr std::uint64_t kMinimumBudget = 256ull * 1024 * 1024;

std::uint64_t PhysicalMemoryBytes() noexcept {
#ifdef _WIN32
  MEMORYSTATUSEX status{};
  status.dwLength = sizeof(status);
  if (GlobalMemoryStatusEx(&status) == 0) return 0;
  return status.ullTotalPhys;
#else
  const long pages = ::sysconf(_SC_PHYS_PAGES);
  const long page_size = ::sysconf(_SC_PAGE_SIZE);
  if (pages <= 0 || page_size <= 0) return 0;
  return static_cast<std::uint64_t>(pages) * static_cast<std::uint64_t>(page_size);
#endif
}

}  // namespace

CancellationTokenPtr NeverCancelled() {
  static const CancellationTokenPtr token = std::make_shared<CancellationToken>();
  return token;
}

unsigned DefaultWorkerCount() noexcept {
  const unsigned hardware = std::thread::hardware_concurrency();
  if (hardware <= 2) return 1;
  return std::min(4u, hardware - 1);
}

std::uint64_t DefaultMemoryBudget() noexcept {
  if (const char* raw = std::getenv("PHOTOY_JOB_MEMORY_BUDGET_MB")) {
    const long long megabytes = std::atoll(raw);
    if (megabytes > 0) return static_cast<std::uint64_t>(megabytes) * 1024 * 1024;
  }
  const std::uint64_t physical = PhysicalMemoryBytes();
  if (physical == 0) return kMinimumBudget;
  return std::max(kMinimumBudget, static_cast<std::uint64_t>(physical * kBudgetShare));
}

JobQueue::JobQueue(unsigned worker_count, std::uint64_t budget_bytes)
    : budget_bytes_(budget_bytes) {
  workers_.reserve(worker_count);
  for (unsigned i = 0; i < worker_count; ++i) {
    workers_.emplace_back([this] { Work(); });
  }
  log::Info("job queue started with " + std::to_string(worker_count) + " worker(s), budget " +
            std::to_string(budget_bytes / (1024 * 1024)) + " MB");
}

JobQueue::~JobQueue() { Shutdown(); }

void JobQueue::CancelKeyLocked(const std::string& key) {
  if (key.empty()) return;
  for (const auto& [id, existing_key] : keys_) {
    if (existing_key != key) continue;
    const auto token = live_.find(id);
    if (token != live_.end()) token->second->Cancel();
  }
}

void JobQueue::Submit(std::uint64_t id, std::string coalesce_key, std::uint64_t memory_estimate,
                      Task task) {
  Entry entry;
  entry.id = id;
  entry.coalesce_key = std::move(coalesce_key);
  entry.memory_estimate = memory_estimate;
  entry.task = std::move(task);
  entry.token = std::make_shared<CancellationToken>();

  {
    const std::lock_guard<std::mutex> lock(mutex_);
    if (stopping_) {
      entry.token->Cancel();
    } else {
      CancelKeyLocked(entry.coalesce_key);
      live_.emplace(id, entry.token);
      if (!entry.coalesce_key.empty()) keys_.emplace(id, entry.coalesce_key);
    }
    pending_.push_back(std::move(entry));
  }
  ready_.notify_one();
}

bool JobQueue::Cancel(std::uint64_t id) {
  const std::lock_guard<std::mutex> lock(mutex_);
  const auto found = live_.find(id);
  if (found == live_.end()) return false;
  found->second->Cancel();
  return true;
}

JobQueueStats JobQueue::Stats() const {
  const std::lock_guard<std::mutex> lock(mutex_);
  return JobQueueStats{budget_bytes_,          admitted_bytes_,
                       peak_admitted_bytes_,   peak_concurrent_jobs_,
                       static_cast<unsigned>(workers_.size())};
}

bool JobQueue::TakeRunnableLocked(Entry& entry) {
  for (auto it = pending_.begin(); it != pending_.end(); ++it) {
    // A cancelled job allocates nothing: it exists only to report back, so the
    // budget must not stand in the way of it doing so.
    const bool free_of_charge = it->token->cancelled();
    const bool fits = admitted_bytes_ + it->memory_estimate <= budget_bytes_;
    // Nothing running means this job has the whole machine. It is admitted even
    // if it does not fit, because refusing it would hang forever - a job larger
    // than the entire budget still has to run sometime.
    const bool alone = running_ == 0 && it == pending_.begin();

    if (!free_of_charge && !fits && !alone) continue;

    entry = std::move(*it);
    pending_.erase(it);
    entry.charged = !free_of_charge;
    if (entry.charged) {
      admitted_bytes_ += entry.memory_estimate;
      peak_admitted_bytes_ = std::max(peak_admitted_bytes_, admitted_bytes_);
    }
    ++running_;
    peak_concurrent_jobs_ = std::max(peak_concurrent_jobs_, running_);
    return true;
  }
  return false;
}

void JobQueue::Work() {
  for (;;) {
    Entry entry;
    bool took = false;
    {
      std::unique_lock<std::mutex> lock(mutex_);
      ready_.wait(lock, [this, &entry, &took] {
        if (stopping_ && pending_.empty()) return true;
        took = TakeRunnableLocked(entry);
        return took;
      });
      if (!took) return;  // only reached while stopping with nothing left
    }

    entry.task(entry.token);

    {
      const std::lock_guard<std::mutex> lock(mutex_);
      if (entry.charged && admitted_bytes_ >= entry.memory_estimate) {
        admitted_bytes_ -= entry.memory_estimate;
      }
      --running_;
      live_.erase(entry.id);
      keys_.erase(entry.id);
    }
    // Freeing budget may unblock more than one waiter.
    ready_.notify_all();
  }
}

void JobQueue::Shutdown() {
  {
    const std::lock_guard<std::mutex> lock(mutex_);
    if (stopping_) return;
    stopping_ = true;
    // Outstanding work is cancelled rather than abandoned, so each task still
    // gets to write its response before the process goes away.
    for (const auto& [id, token] : live_) token->Cancel();
  }
  ready_.notify_all();

  for (std::thread& worker : workers_) {
    if (worker.joinable()) worker.join();
  }
  workers_.clear();
}

}  // namespace photoy
