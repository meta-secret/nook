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
    required PR-check execution.
  - Each stage re-fetches and resolves the latest committed branch head for
    build-only and type-compilation work, recording the exact SHA as
    observational evidence only. A stale caller-provided feature SHA does not
    reject branch-authorized execution.
  - Keep tests, coverage, e2e, and preflight outside its transitive task graph.
  - Author meaningful tests for later execution.
  - Require code review and security acceptance before feature pull-request delivery.
- **Feature PR required checks**
  - The manually run Feature Gizmo selects the published feature branch.
  - The Feature Gizmo authorizes Team Gizmo (Delivery Pipeline context) to route the
    publication and validation packet through the active harness to internal
    PR Lifecycle Agent for bounded execution.
  - The Feature Gizmo retains readiness policy authority, and
    `feature PR lifecycle` remains the sole pull-request creation/update path; Team
    Gizmo and PR Lifecycle Agent do not create or update pull requests or
    decide policy, readiness, or promotion verdicts.
  - Run the full required PR checks on the captured feature head SHA.
  - Preserve e2e opt-ins and security-required focused browser checks.
  - Use native non-cancelling concurrency with one active and latest pending.
  - Run complete checks without per-push path-filter reductions.
  - Route failures through feature compilation and feature pull-request delivery.
- **Execution infrastructure**
  - Use the configured remote runner for compilation and required checks.
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
compilation only. Return evidence through Team Gizmo (Delivery Pipeline context) to the
owning controller. The Feature Gizmo decides merge readiness; merge requires
the feature PR required checks, review, and security acceptance for the
published feature head.
