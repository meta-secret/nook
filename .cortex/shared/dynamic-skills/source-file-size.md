# Critical Source File Size and Architectural Decomposition

## Priority

This is a hard, non-bypassable delivery gate. A violation is P1 and blocks
delivery until the file is brought within the limit through a cohesive change.

## Purpose

Keep authored source modules small enough to preserve clear ownership,
dependency direction, reviewability, and behavior-focused testing. Crossing the
threshold proves a gate violation; review still determines the cohesive domain
or architectural seam needed to correct it.

## Hard Limits

- Every authored source file, including Rust: at most **1,000 lines**.
- Files above their limit are prohibited. There are no authored-code
  allowlists, baselines, grandfathered violations, or changed-file-only
  exceptions.

Rust receives no larger allowance. A Rust file above 1,000 lines must be
reviewed and decomposed along a cohesive domain or architectural seam; line
count alone does not diagnose which responsibility is wrong. Colocated focused
unit tests do not justify retaining an oversized production abstraction. Keep
each new module's tests with the behavior it owns.

## Problem Pattern

An oversized file commonly combines multiple domains, capabilities, lifecycle
phases, adapters, storage concerns, or orchestration layers. Warning signs
include:

- unrelated structs and implementations changing for different reasons;
- a service that owns policy, persistence, transport, mapping, and retries;
- a UI module that combines state, orchestration, rendering, and provider
  adapters;
- broad action contexts that expose an entire store or manager;
- Rust unit tests placed in separate files under `src`;
- attempts to comply by moving `#[cfg(test)]` code;
- arbitrary half-splits or names such as `part1`, `part2`, or `continued`.

Moving tests alone can lower the line count while leaving the production
architecture untouched. Separate Rust unit-test files are prohibited even when
production code was also split.

## Preferred Pattern

Before editing, identify why the file changes and who owns each responsibility.
Split production code along one or more real seams:

- domain or aggregate;
- capability or use case;
- policy versus mechanism;
- lifecycle phase;
- storage, transport, mapping, or orchestration boundary;
- platform-independent domain versus platform adapter;
- public facade versus internal implementation.

Each extracted module must be cohesive, have a meaningful domain name, and
depend through the narrowest practical interface. Preserve dependency
direction; do not make every child module depend on the original god object.
Prefer capability interfaces such as `ProviderActionsContext` over passing a
whole state container.

Tests must follow the same architecture. Rust unit tests belong in an inline
`#[cfg(test)] mod tests` inside the focused implementation module. Split the
production abstraction first, then colocate each abstraction's unit tests with
its new owning module.

Rust integration tests under the crate-level `tests/` directory remain
separate because they exercise the crate through its public boundary. Do not
relabel unit tests as integration tests merely to evade colocation.

## Scope

Applies to all authored source code in the repository, including production
code, tests, scripts, build logic, and agent/CI tooling.

Excluded from counting:

- generated source and checked-in generated bindings;
- vendored third-party dependencies;
- build outputs, caches, coverage artifacts, and package-manager directories;
- non-source fixture data and documentation.

An exclusion must describe data provenance, not excuse authored source.

## Examples

- Rejected: move 900 lines of `#[cfg(test)]` from a 1,700-line Rust service
  into `service_tests.rs` while leaving the multi-responsibility
  service unchanged.
- Rejected: keep `service_tests.rs` under `src` after splitting production
  responsibilities; unit tests belong inline with each owning abstraction.
- Rejected: split `service.rs` into `service_part1.rs` and
  `service_part2.rs`.
- Accepted: extract provider query mapping, retry policy, and persistence into
  cohesive modules with narrow interfaces, then place inline unit-test modules
  in the production module that owns each behavior.
- Accepted: keep public-boundary integration scenarios in the crate-level
  `tests/` directory.
- Accepted: split a large browser flow into lifecycle, enrollment, session, and
  transport capabilities while preserving a small facade.

## Application Checklist

- [ ] Inventory the file's production responsibilities and change reasons.
- [ ] Name the architectural or domain seams before moving code.
- [ ] Refactor production code into cohesive modules with narrow interfaces.
- [ ] Confirm no extracted module is an arbitrary numbered fragment.
- [ ] Confirm Rust unit tests are inline with their focused implementation,
      never in separate files under `src`.
- [ ] Preserve or add behavior-focused unit and integration tests at their
      correct boundaries.
- [ ] Return a verified committed handoff with the focused worker proof.
- [ ] Have Gizmo integrate the handoff and run `task loom:pre-push`.
- [ ] Have Gizmo push. If the head is not validation-ready, Gizmo may run the
      repository source-size scanner through a focused hosted preflight task.
- [ ] Have Gizmo dispatch complete exact-head validation when the head is
      ready. The complete gate includes the source-size scanner.

## Static Enforcement

The repository-wide preflight scanner fails when any authored source file
crosses the uniform 1,000-line limit or Rust unit tests live in an external
module under `src`. Its failure message directs the agent to architectural
decomposition and explicitly rejects test-file and arbitrary splits.

Static line counting proves only that the hard delivery gate passed or failed.
It cannot prove cohesion, identify the defective responsibility, or establish
dependency direction. Contract tests keep the limit wired into Cortex and
scanner diagnostics; code review verifies the actual decomposition seam.

## Validation

Ordinary workers return a verified committed handoff. Gizmo runs
`task loom:pre-push` before every push. Gizmo uses a focused hosted preflight
task only while the head is not validation-ready. A ready head enters the
complete PR gate, which includes the scanner.
