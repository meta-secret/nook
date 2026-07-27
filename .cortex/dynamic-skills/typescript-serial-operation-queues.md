# TypeScript Serial Operation Queues

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
