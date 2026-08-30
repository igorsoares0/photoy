#pragma once

#include <atomic>
#include <memory>

namespace photoy {

/**
 * A flag a running job polls to find out it is no longer wanted.
 *
 * Shared by pointer so the queue can cancel a job that is already executing:
 * the worker holds the same flag the caller flipped.
 */
class CancellationToken {
 public:
  void Cancel() noexcept { cancelled_.store(true, std::memory_order_relaxed); }
  bool cancelled() const noexcept { return cancelled_.load(std::memory_order_relaxed); }

 private:
  std::atomic<bool> cancelled_{false};
};

using CancellationTokenPtr = std::shared_ptr<CancellationToken>;

/// Never-cancelled token, for call sites that have nothing to cancel.
CancellationTokenPtr NeverCancelled();

}  // namespace photoy
