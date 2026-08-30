#include "jobs/job_queue.h"

#include <algorithm>
#include <utility>

#include "core/log.h"

namespace photoy {
namespace {

CancellationTokenPtr MakeNeverCancelled() {
  return std::make_shared<CancellationToken>();
}

}  // namespace

CancellationTokenPtr NeverCancelled() {
  static const CancellationTokenPtr token = MakeNeverCancelled();
  return token;
}

unsigned DefaultWorkerCount() noexcept {
  const unsigned hardware = std::thread::hardware_concurrency();
  if (hardware <= 2) return 1;
  return std::min(4u, hardware - 1);
}

JobQueue::JobQueue(unsigned worker_count) {
  workers_.reserve(worker_count);
  for (unsigned i = 0; i < worker_count; ++i) {
    workers_.emplace_back([this] { Work(); });
  }
  log::Info("job queue started with " + std::to_string(worker_count) + " worker(s)");
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

void JobQueue::Submit(std::uint64_t id, std::string coalesce_key, Task task) {
  Entry entry;
  entry.id = id;
  entry.coalesce_key = std::move(coalesce_key);
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

void JobQueue::Work() {
  for (;;) {
    Entry entry;
    {
      std::unique_lock<std::mutex> lock(mutex_);
      ready_.wait(lock, [this] { return stopping_ || !pending_.empty(); });
      if (pending_.empty()) return;  // only reached while stopping
      entry = std::move(pending_.front());
      pending_.pop_front();
    }

    entry.task(entry.token);

    {
      const std::lock_guard<std::mutex> lock(mutex_);
      live_.erase(entry.id);
      keys_.erase(entry.id);
    }
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
