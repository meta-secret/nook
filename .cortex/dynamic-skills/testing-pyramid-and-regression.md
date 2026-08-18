# Testing Pyramid and Regression Coverage

## Purpose

Enforce Nook's testing hierarchy: unit and property tests in portable Rust crates own domain correctness; Playwright e2e is smoke coverage only. Every bug fix must add reproducible regression coverage, and combined portable Rust crates must maintain at least a 90% line coverage floor.

## Problem Pattern

- Relying on slow, brittle end-to-end Playwright tests to catch domain, cryptographic, or sync regressions.
- Fixing a bug without an automated regression test reproducing the original defect.
- Allowing combined Rust line coverage to drop below the 90% floor.
- Re-implementing Rust domain rules in TypeScript for testing rather than testing domain code directly in Rust.

## Preferred Pattern

### Testing pyramid (~99% domain coverage in Rust)

1. **Rust unit and property tests carry ~99% of functional domain coverage:**
   - Test event sourcing, causal DAG merge, projection replay, epoch rotation, cryptography, and multi-device sync in Rust (`nook-app-common`, `nook-auth2`, `nook-replication`, `nook-event-log`, `nook-core`).
   - Use colocated module tests for pure mechanics and crate `tests/*.rs` integration files for multi-device sync orchestration.
2. **Playwright e2e tests are smoke tests:**
   - E2e tests cover critical user flows (unlock, save, local provider sync, conflict UI).
   - E2e tests do not prove mathematical or algorithmic correctness of domain logic.

### Mandatory regression coverage for bug fixes

Finding a root cause is not completion. Every bug fix must include behavior-focused regression coverage that would have failed before the fix:

- **Domain logic (`nook-platform/` crates):** Add a unit, property, or integration test at the owning boundary.
- **Typed Rust/WASM boundary:** If reproducible without a browser, add a narrow Rust/WASM test first.
- **Web UI or browser extension:** Add a Playwright e2e test reproducing the exact user sequence.
- **Cross-layer bugs:** Cover both the narrow Rust/WASM policy boundary and the visible website/extension flow.

### 90% Rust line coverage floor

The portable Rust crates (`nook-app-common`, `nook-core`, `nook-auth2`, `nook-replication`, `nook-event-log`) are measured together and checked against a committed 90% floor in `nook-app/nook-platform/nook-core/coverage-floor.json`:

- Coverage below 90% fails the CI gate (`task rust:coverage:check`).
- When under 90%, add Rust tests in the same task.
- At or above 90%, do not chase marginal line coverage; focus on behavior and invariants.

## Scope

Applies to:

- All domain logic, cryptographic operations, sync mechanisms, and state machines.
- All bug fixes across Rust, WASM, Svelte, and browser extensions.
- CI and local test execution.

Does not apply to:

- Purely visual design tweaks with no business logic.

## Application Checklist

1. [ ] Domain logic changes have colocated Rust unit or property tests.
2. [ ] Bug fixes include a test that reproduces the defect.
3. [ ] `task rust:test` passes with all tests green.
4. [ ] Rust line coverage remains at or above 90% (`task rust:coverage:check`).
5. [ ] App logs (`nook-app-logs.json`, `/logs`) are consulted when debugging test failures.

## Validation

- Run unit & domain tests: `task rust:test`
- Verify coverage floor: `task rust:coverage:check`
- Run web e2e smoke tests: `task web:test:e2e`
