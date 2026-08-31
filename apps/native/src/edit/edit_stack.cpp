#include "edit/edit_stack.h"

#include <algorithm>

namespace photoy {

const Operation& EditStack::Apply(Operation operation, bool replace_top) {
  // Editing past an undo abandons what was undone; keeping it would make the
  // history a tree, and the product does not offer one.
  operations_.resize(cursor_);

  if (replace_top && cursor_ > 0 && operations_.back().kind == operation.kind) {
    // The id is kept so the history entry the UI is showing stays the same one.
    operation.id = operations_.back().id;
    operations_.back() = std::move(operation);
    return operations_.back();
  }

  operation.id = next_id_++;
  operations_.push_back(std::move(operation));
  cursor_ = operations_.size();
  return operations_.back();
}

bool EditStack::Undo() noexcept {
  if (!CanUndo()) return false;
  --cursor_;
  return true;
}

bool EditStack::Redo() noexcept {
  if (!CanRedo()) return false;
  ++cursor_;
  return true;
}

void EditStack::Seek(std::size_t cursor) noexcept {
  cursor_ = std::min(cursor, operations_.size());
}

void EditStack::Clear() noexcept {
  operations_.clear();
  cursor_ = 0;
}

void EditStack::Load(std::vector<Operation> operations, std::size_t cursor) {
  operations_ = std::move(operations);
  cursor_ = std::min(cursor, operations_.size());
  // Identifiers are handed out fresh; nothing outside holds one across a load.
  next_id_ = 1;
  for (Operation& operation : operations_) operation.id = next_id_++;
}

std::vector<Operation> EditStack::Active() const {
  return std::vector<Operation>(operations_.begin(),
                                operations_.begin() + static_cast<std::ptrdiff_t>(cursor_));
}

}  // namespace photoy
