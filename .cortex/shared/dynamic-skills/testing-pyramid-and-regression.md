# Testing Pyramid and Regression Coverage

## Purpose

Enforce Nook's testing hierarchy. Unit and property tests in portable Rust
crates own domain correctness. Narrow WASM tests own typed browser boundaries.
Playwright owns observable browser integration scenarios. Every bug fix must
add reproducible regression coverage. Combined portable Rust crates must
maintain at least a 90% line coverage floor.

## Problem Pattern

- Relying on slow, brittle end-to-end Playwright tests to catch domain, cryptographic, or sync regressions.
- Fixing a bug without an automated regression test reproducing the original defect.
- Allowing combined Rust line coverage to drop below the 90% floor.
- Re-implementing Rust domain rules in TypeScript for testing rather than testing domain code directly in Rust.
- Leaving durable Cortex scenarios without executable evidence at the owning
  layer.
- Leaving valuable behavior encoded only in tests when it should be explained
  in the owning product specification.
- Keeping a Playwright specification that no repository-owned gate executes.

## Preferred Pattern

### Testing pyramid (~99% domain coverage in Rust)

1. **Rust unit and property tests carry ~99% of functional domain coverage:**
   - Test event sourcing, causal DAG merge, projection replay, epoch rotation, cryptography, and multi-device sync in Rust (`nook-app-common`, `nook-auth2`, `nook-replication`, `nook-event-log`, `nook-core`).
   - Use colocated module tests for pure mechanics and crate `tests/*.rs` integration files for multi-device sync orchestration.
2. **WASM tests own typed browser boundaries:**
   - Test projections, DTOs, browser storage adapters, and Rust-owned policy
     exposed to JavaScript.
   - Do not duplicate portable domain algorithms in WASM tests.
3. **Playwright tests own observable browser integration:**
   - Cover critical user flows such as unlock, save, local provider sync,
     recovery, import, secret disclosure, and conflict UI.
   - Cover browser-only sequencing, persistence, visibility, clipboard,
     download, multi-tab, extension, and origin behavior.
   - Do not use browser tests to prove mathematical or algorithmic correctness
     that portable Rust can establish directly.

### Bidirectional Cortex scenario review

Use Cortex and executable tests as two evidence sources that must remain
consistent.

1. Read the owning product or architecture specification.
2. Extract durable scenarios with security, authorization, persistence,
   recovery, data-loss, or user-observable consequences.
3. Assign each scenario to its authoritative test boundary.
   - Portable policy and invariants belong in Rust.
   - Typed browser projections and storage adapters belong in WASM tests.
   - Complete browser interactions belong in Playwright.
   - Build, deployment, and repository wiring belong in preflight or artifact
     contracts.
4. Compare existing tests in the opposite direction.
   - Promote behavior into the owning specification when the scenario is
     durable, intentional, and useful for future product decisions.
   - Keep fixtures, selectors, timings, and implementation mechanics in tests.
5. Exclude draft or speculative behavior until the owning specification marks
   it as implemented.
6. When a Playwright suite partitions specifications across projects, require
   every non-demo behavior specification to appear exactly once in the shared
   executable gate manifest. Suites that rely on default `testDir` discovery
   do not need a redundant manifest.

Do not mechanically translate Markdown sentences into tests. Choose scenarios
through architectural ownership and risk.

### Mandatory regression coverage for bug fixes

Finding a root cause is not completion. Every bug fix must include behavior-focused regression coverage that would have failed before the fix:

- **Domain logic (`nook-platform/` crates):** Add a unit, property, or integration test at the owning boundary.
- **Typed Rust/WASM boundary:** If reproducible without a browser, add a narrow Rust/WASM test first.
- **Web UI or browser extension:** Add a Playwright e2e test reproducing the exact user sequence.
- **Cross-layer bugs:** Cover both the narrow Rust/WASM policy boundary and the visible website/extension flow.

### 90% Rust line coverage floor

The portable Rust crates (`nook-app-common`, `nook-authenticator-domain`,
`nook-companion-core`, `nook-core`, `nook-auth2`, `nook-replication`, and
`nook-event-log`) are measured together. They are checked against a committed
90% floor in `nook-app/nook-platform/nook-core/coverage-floor.json`:

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
3. [ ] Hosted Rust domain tests pass with all tests green.
4. [ ] Hosted Rust line coverage remains at or above 90%.
5. [ ] App logs (`nook-app-logs.json`, `/logs`) are consulted when debugging test failures.
6. [ ] Durable Cortex scenarios have evidence at the authoritative boundary.
7. [ ] Durable behavior discovered in tests is reflected in the owning Cortex
       specification when it affects future product decisions.
8. [ ] Every non-demo Playwright behavior specification belongs to a gate.

## Validation

- Gizmo dispatches the relevant allowlisted hosted Rust task for unit, domain,
  and coverage evidence.
- Gizmo dispatches the relevant allowlisted hosted browser task for web e2e
  evidence.
