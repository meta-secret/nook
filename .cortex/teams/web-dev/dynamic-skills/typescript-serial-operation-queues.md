# TypeScript Serial Operation Queues

## Purpose

Keep asynchronous serialization explicit without exposing mutable promise
chains throughout application state.

## Problem Pattern

The rejected shape has these properties:

- An application class appends work to a public promise field.
- Success and error callbacks both replace the field and discard the result.
- Callers can depend on or mutate the raw queue tail.
- Queue lifecycle operations require casts or duplicated promise plumbing.

The code may run correctly while keeping its serialization invariant implicit.

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

- Apply this rule to authored TypeScript queues that serialize asynchronous
  browser, storage, or WASM operations.
- Keep a richer scheduler when it needs:
  - priorities;
  - cancellation;
  - expiration;
  - backpressure; or
  - close semantics.

## Validation

- Search consumers for direct access to the old promise-chain field.
- Confirm an operation failure still reaches its caller.
- Confirm later queued operations still run after an earlier failure.
- Confirm the idle barrier never rejects.
- Run `git diff --check`; run product validation only through the normal
  repository workflow.
