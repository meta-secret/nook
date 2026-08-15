# TypeScript Serial Operation Queues

## Relationships

- [Cortex document navigation](cortex-document-map.md)
  - Defines the mandatory relationship and internal-map structure.
  - Apply whenever this skill card changes.
- [Cortex writer](cortex-writer.md)
  - Keeps the card and its navigation summaries concise.
  - Apply while editing or reviewing this guidance.
- [Cortex consistency](cortex-consistency.md)
  - Requires the card to agree with related guidance and current code.
  - Apply when rules, paths, commands, or examples change.

## Document map

- [Purpose](#purpose)
  - Explains why the skill exists and what invariant it protects.
  - Read first to decide whether the skill applies.
- [Problem Pattern](#problem-pattern)
  - Identifies the recurring rejected pattern and its warning signs.
  - Read while locating or reviewing violations.
- [Preferred Pattern](#preferred-pattern)
  - Defines the required structure or behavior.
  - Read before implementing a correction.
- [Scope](#scope)
  - Sets the applicable paths and explicit boundaries.
  - Read before expanding the task.
- [Validation](#validation)
  - Names the smallest relevant mechanical and semantic proof.
  - Run before completing the task.

## Purpose

Keep asynchronous serialization explicit without exposing mutable promise
chains throughout application state.

## Problem Pattern

Application classes manually append work to a public promise field and replace
the field with success/error callbacks that both discard the result. The code
works, but its queue invariant is implicit, callers can depend on or mutate the
raw tail, and queue lifecycle operations require casts or duplicated promise
plumbing.

## Preferred Pattern

Encapsulate a serial queue behind a small ordinary TypeScript class with named
operations:

- `enqueue` returns the individual operation promise, including its failure.
- The internal tail absorbs that failure so later operations still run.
- `onIdle` exposes a non-rejecting barrier without exposing the tail.
- `reset` is explicit and reserved for recovery tooling that intentionally
  detaches future work from an existing tail.

Keep browser/WASM operation scheduling in TypeScript. Rust owns domain policy,
not JavaScript promise coordination.

## Scope

Apply this rule to authored TypeScript queues that serialize asynchronous
browser, storage, or WASM operations. Do not replace a scheduler that needs
priorities, cancellation, expiration, backpressure, or close semantics with the
minimal serial queue.

## Validation

- Search consumers for direct access to the old promise-chain field.
- Confirm an operation failure still reaches its caller.
- Confirm later queued operations still run after an earlier failure.
- Confirm the idle barrier never rejects.
- Run `git diff --check`; run product validation only through the normal
  repository workflow.
