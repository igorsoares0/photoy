#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

#include "edit/operation.h"

namespace photoy {

/**
 * A document's history, as a list of operations and a cursor into it.
 *
 * Undo moves the cursor rather than restoring a saved image, so a step costs
 * nothing in memory no matter how large the document is. Applying a new
 * operation while the cursor sits short of the end drops the entries after it,
 * which is what makes the redo branch disappear once you edit past it.
 */
class EditStack {
 public:
  /**
   * Appends an operation, discarding any redo tail, and returns it with its id.
   *
   * With `replace_top`, an operation of the same kind already on top is
   * overwritten instead. That is what keeps a dragged slider from leaving one
   * history entry per frame: the gesture becomes a single step to undo.
   */
  const Operation& Apply(Operation operation, bool replace_top = false);

  bool CanUndo() const noexcept { return cursor_ > 0; }
  bool CanRedo() const noexcept { return cursor_ < operations_.size(); }

  /// Returns false when there was nothing to move past.
  bool Undo() noexcept;
  bool Redo() noexcept;

  /// Drops every operation, returning the document to the original.
  void Clear() noexcept;

  /// The operations currently in effect, in order.
  std::vector<Operation> Active() const;

  /// Everything recorded, including the redo tail, for the history panel.
  const std::vector<Operation>& All() const noexcept { return operations_; }

  /// How many entries are in effect. Entries past this are redoable.
  std::size_t cursor() const noexcept { return cursor_; }

 private:
  std::vector<Operation> operations_;
  std::size_t cursor_ = 0;
  std::uint64_t next_id_ = 1;
};

}  // namespace photoy
