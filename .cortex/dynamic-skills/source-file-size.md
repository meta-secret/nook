# Critical Source File Size and Architectural Decomposition

## Priority

This is Nook's most critical code-structure rule. A violation is a P1
architecture finding and blocks delivery.

## Purpose

Keep authored source modules small enough to preserve clear ownership,
dependency direction, reviewability, and behavior-focused testing. A hard-limit
failure requires architectural refactoring, not cosmetic redistribution.

## Hard Limits

- Non-Rust authored source: at most **1,000 lines**.
- Rust authored source: at most **1,500 lines**.
- Files above their limit are prohibited. There are no authored-code
  allowlists, baselines, grandfathered violations, or changed-file-only
  exceptions.

The Rust allowance exists only because idiomatic Rust often colocates focused
unit tests with their implementation. It is not permission for a production
module to accumulate unrelated responsibilities.

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
  into `service_tests.rs` while leaving the 800-line multi-responsibility
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
- [ ] Run the repository source-size scanner and inspect every violation.
- [ ] Run `task format`, push, and use exact-head GitHub Actions for product
      validation.

## Static Enforcement

The repository-wide preflight scanner fails when any authored source file
crosses its language limit or Rust unit tests live in an external module under
`src`. Its failure message directs the agent to architectural decomposition and
explicitly rejects test-file and arbitrary splits.

Static line counting cannot prove cohesion or dependency direction. Contract
tests keep this critical guidance wired into `.cortex`, the executable skill,
and scanner diagnostics; code review must verify the actual architectural seam.

## Validation

Run the focused preflight source-size tests while developing the gate. Before
every push, run `task format`. GitHub Actions owns the complete product gate.
