# Nook Test Surfaces and Coverage

Meta-Cortex [programming requirements](../../../.meta-cortex/teams/dev-team/docs/programming/testing-pyramid-and-regression.md)
own the testing pyramid and regression-before-fix procedure.
Nook supplies its product scenario mapping, existing harnesses, and
coverage gate here. Execute checks only in the Nook-authorized delivery stage.

## Product evidence

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

Apply the upstream regression procedure to the actual failing boundary.
Test portable vault, event-log, cryptographic, and sync decisions in Rust.
Use typed WASM tests for the bridge and Playwright for browser-only behavior.

**Prohibited:** replace a Rust vault-policy regression with browser E2E alone.

**Preferred:** author the Rust regression and retain the user-flow assertion.
Report before/after execution as pending until the authorized stage runs it.

### Existing browser harnesses

- Zero-vault DOM authentication: companion DOM and credential-fill simulations
  under the web app's unit-test suite.
- Extension session and delivery: the extension's service-worker routing suite.
- Extension-to-vault transport: the extension's companion protocol composition suite.

Use the actual typed transport contracts. Add regressions to the existing owner
instead of building another harness for the same boundary.

### 90% Rust line coverage floor

The portable Rust crates (`nook-app-common`, `nook-authenticator-domain`,
`nook-companion-core`, `nook-core`, `nook-auth2`, `nook-replication`, and
`nook-event-log`) are measured together. They are checked against a committed
90% floor in `nook-app/nook-platform/nook-core/coverage-floor.json`:

- Coverage below 90% fails the CI gate (`task rust:coverage:check`).
- When under 90%, add Rust tests in the same task.
- At or above 90%, do not chase marginal line coverage; focus on behavior and invariants.

