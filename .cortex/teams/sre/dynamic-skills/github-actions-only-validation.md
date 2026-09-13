# GitHub Actions Execution and Validation

## Purpose

The [dev delivery contract](../../../gizmo-prime/architecture/dev-delivery.md)
defines two remote stages. Agents keep local work limited to editing, reading,
scoped rustfmt, and bounded inexpensive TS diagnostics or formatting.

## Required actions

- **Feature compilation**
  - The owning Feature Gizmo publishes the canonical feature branch.
  - Gizmo Prime authorizes the canonical feature branch request; Delivery Pipeline
    Team Gizmo dispatches PR Lifecycle Agent through the active harness for
    remote build-only execution.
  - Each stage re-fetches and resolves the latest committed branch head for
    build-only and type-compilation work, recording the exact SHA as
    observational evidence only. A stale caller-provided feature SHA does not
    reject branch-authorized execution.
  - Keep tests, coverage, e2e, and preflight outside its transitive task graph.
  - Author meaningful tests for later execution.
  - Require code review and security acceptance before local dev landing.
- **Slow dev PR checks**
  - The manually run dev manager selects the published dev snapshot.
  - The dev manager authorizes Delivery Pipeline Team Gizmo to route the
    publication and validation packet through the active harness to internal
    PR Lifecycle Agent for bounded execution.
  - The dev manager retains manager-stage policy authority, and
    `dev:pr-manager` remains the sole pull-request creation/update path; Team
    Gizmo and PR Lifecycle Agent do not create or update pull requests or
    decide policy, readiness, or promotion verdicts.
  - Run the full existing slow PR checks on the captured dev head SHA.
  - Preserve e2e opt-ins and security-required focused browser checks.
  - Freeze remote dev during checking and promotion.
  - Use native non-cancelling concurrency with one active and latest pending.
  - Run complete checks without per-push path-filter reductions.
  - Route failures through feature compilation and local dev integration.
- **Execution infrastructure**
  - Use the configured remote runner for compilation and slow checks.
  - Preserve existing container, credential, and trust boundaries.
  - See [remote execution](../workflows/remote-execution.md) for runner details.

## Prohibited actions

- Do not run local tests, Docker work, product compilation, or coverage.
- Do not treat `rust:ci`, `web:verify`, or `loom:verify` as build-only.
- Do not add an automatic dev-push slow pipeline.
- Do not cancel an active slow run or create a custom scheduler.
- Do not replace missing remote evidence with local execution.

## Evidence

Capture source SHA, run, attempt, and result. Feature build success proves
compilation only. Return evidence through Delivery Pipeline Team Gizmo to the
owning controller. The dev manager decides the manager-stage verdict and
promotion; promotion requires slow-stage tests, review, and security
acceptance for the exact published SHA.
