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

Every executable bug fix starts with a meaningful set of unit tests before
the implementation changes. Finding the root cause alone is not completion.
Test execution follows [dev delivery](../../gizmo-prime/architecture/dev-delivery.md).

**Required actions**

1. Understand the reported failure before changing implementation.
   - Identify the trigger, root cause, expected behavior, and owning boundary.
2. Author the unit regression set before implementing the fix.
   - Reproduce the original defect with an assertion on expected behavior.
   - Cover the relevant success, rejection, and edge cases around that defect.
   - Choose cases for distinct behavior and risk, not an arbitrary test count.
   - Exercise production contracts rather than copying implementation logic.
3. Keep coverage at the owning layer.
   - For portable domain bugs, write colocated Rust unit tests.
   - Add property or integration tests when invariants or orchestration need
     further coverage.
   - For typed Rust/WASM bugs, test the narrow owning boundary.
   - For browser-only bugs, cover the closest deterministic unit contract.
   - Retain a Playwright regression for the actual browser or extension flow.
   - For cross-layer bugs, cover the affected Rust/WASM contract and user flow.
4. Make the smallest correction in the implementation owner.
   - Retain the regression set in its existing automated test gate.
5. Hand off the regression cases and before/after verification requirements.
   - Identify the buggy revision, fixed revision, and focused test selection.
   - Review why the original-failure assertion detects the defect.
   - Record execution evidence as pending until authorized runs establish it.
6. In the dev manager's authorized slow PR stage, verify regression sensitivity.
   - Verify the original-failure test fails without the fix for the expected
     behavioral reason.
   - Verify the regression set and applicable suite pass with the fix.
   - Record the tested revisions, run references, and observed results.
   - Report unavailable before/after execution capability to the manager.
   - Keep missing evidence explicit rather than claiming verified protection.

**Prohibited actions**

- Do not implement the fix first and add its unit tests afterward.
- Do not replace domain unit tests with integration or e2e coverage alone.
- Do not weaken assertions or accept unrelated failures as reproduction.
- Do not claim test authorship, semantic review, or compilation proves a pass.
- Do not run local tests or feature-stage remote tests to obtain evidence.
- Do not create a new execution route to bypass delivery-stage restrictions.
- Do not require slow-stage results before normal feature landing into local dev.

### Unit-first browser failure loop

Use this procedure for a failing web or extension e2e scenario.

**Required actions**

1. Read the saved job output, app logs, error context, and Playwright trace.
   Identify the first failing behavior and its owning boundary before changing
   code.
2. Select the smallest applicable existing regression framework.
   - Zero-vault DOM and authentication behavior uses
     [`companion-dom-authentication-simulation.ts`](../../../nook-app/nook-web/nook-web-app/tests/unit/lib/companion-dom-authentication-simulation.ts)
     and
     [`companion-credential-fill-simulation.ts`](../../../nook-app/nook-web/nook-web-app/tests/unit/lib/companion-credential-fill-simulation.ts).
   - Extension delivery and session lifecycle use the existing focused
     extension suites, including
     [`service-worker-routing.test.ts`](../../../nook-app/nook-web/nook-web-extension/scripts/service-worker-routing.test.ts).
   - Extension-to-vault protocol behavior uses the real endpoint composition
     in
     [`companion-protocol-composition.test.ts`](../../../nook-app/nook-web/nook-web-extension/scripts/companion-protocol-composition.test.ts).
   - Use only the frameworks that exercise the failing ownership boundary.
3. Apply the mandatory regression procedure above before fixing the defect.
   - Exercise actual transport contracts such as typed `Result` values.
   - Do not use permissive mocks that return a shape production cannot return.
4. Make the smallest owning correction and hand off the authored regressions.
   - Feature-stage remote execution remains build-only.
   - Do not bypass the generated boundary with a local build override.
5. Keep the browser assertion for the manager's slow PR validation stage.
   - For a browser-only defect, cover the closest deterministic unit contract
     and retain the browser-level regression.
   - Unit evidence narrows the repair loop. It does not replace e2e acceptance.
   - The dev manager requests applicable browser gates through the dev PR.
   - Diagnose returned failing-job evidence before the next repair.
   - Author the applicable unit regressions before changing that repair's code.

**Prohibited actions**

- Do not weaken assertions, increase timeouts, or skip a failing scenario as
  the fix.
- Do not create a new test framework when an existing owner can express the
  behavior.
- Do not measure coverage quality by test count alone. Require meaningful
  contract and branch evidence.

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
- All executable bug fixes, including Rust, WASM, web, extensions, and tooling.
- Test authoring and authorized CI execution.

Does not apply to:

- Purely visual design tweaks with no behavioral defect.
- Instruction-only documentation edits without executable behavior changes.

## Application Checklist

1. [ ] Domain logic changes have colocated Rust unit or property tests.
2. [ ] Bug fixes have meaningful unit regression sets authored before the fix.
3. [ ] Before/after verification has evidence or an explicit pending status.
4. [ ] Rust test and coverage results are recorded in the authorized slow stage.
5. [ ] App logs (`nook-app-logs.json`, `/logs`) are consulted when debugging test failures.
6. [ ] Durable Cortex scenarios have evidence at the authoritative boundary.
7. [ ] Durable behavior discovered in tests is reflected in the owning Cortex
       specification when it affects future product decisions.
8. [ ] Every non-demo Playwright behavior specification belongs to a gate.

## Validation

Follow [dev delivery](../../gizmo-prime/architecture/dev-delivery.md) for execution
authority. Feature workers author tests and review their behavior coverage.
Remote feature compilation is build-only. Tests, coverage, and browser gates
execute through the dev manager's slow PR validation path.

- Record failing-without-fix evidence for the original regression assertion.
- Record passing-with-fix evidence for the regression set and applicable suite.
- Record the combined Rust coverage result against the 90% floor.
- Record applicable browser regression results for changed user flows.
- Preserve pending or unavailable evidence explicitly in the handoff.
