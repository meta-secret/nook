# GitHub Actions Execution and Validation

## Purpose

The [dev delivery contract](../../../gizmo/architecture/dev-delivery.md)
defines two remote stages. Agents keep local work limited to editing, reading,
scoped rustfmt, and bounded inexpensive TS diagnostics or formatting.

## Required actions

- **Feature compilation**
  - Publish the feature branch and request remote build-only execution.
  - Execute build-only and type-compilation work for the exact feature SHA.
  - Keep tests, coverage, e2e, and preflight outside its transitive task graph.
  - Author meaningful tests for later execution.
  - Require code review and security acceptance before local dev landing.
- **Slow dev PR checks**
  - The manually run dev manager selects the published dev snapshot.
  - PR Steward executes the manager's publication and validation packets.
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
compilation only. Promotion requires slow-stage tests, review, and security
acceptance for the exact published SHA.
