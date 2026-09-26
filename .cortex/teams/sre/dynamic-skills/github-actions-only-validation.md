# GitHub Actions Execution and Validation

## Purpose

The [dev delivery contract](../../../gizmo-prime/architecture/dev-delivery.md)
defines the remote build-only and required-check stages. Hosted execution is the
default. Follow the root [delivery and validation policy](../../../AGENTS.md#delivery-and-validation)
for any bounded local diagnostic. Local results never replace required hosted
PR checks.

## Required actions

- **Feature compilation**
  - The owning Feature Gizmo publishes the canonical feature branch.
  - Gizmo Prime authorizes the canonical feature branch request. Team Gizmo
    assigns publication to PR Lifecycle and hosted execution to upstream CI/CD
    with Nook SRE context.
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
    PR Lifecycle Agent for publication and check observation. Upstream CI/CD
    handles required workflow dispatches, reruns, and pipeline diagnostics.
  - The Feature Gizmo retains readiness policy authority, and
    `feature PR lifecycle` remains the sole pull-request creation/update path; Team
    Gizmo routes authorized mechanics and PR Lifecycle Agent creates or updates
    the pull request without deciding policy, readiness, or promotion verdicts.
  - Run the full required PR checks on the captured feature head SHA.
  - Preserve e2e opt-ins and security-required focused browser checks.
  - Use native PR concurrency that cancels stale-head validation when a newer
    event supersedes it; separate pull requests remain independent.
  - Run complete checks without per-push path-filter reductions.
  - Route failures through feature compilation and feature pull-request delivery.
- **Execution infrastructure**
  - Use the configured remote runner for compilation and required checks.
  - Preserve existing container, credential, and trust boundaries.
  - See [remote execution](../workflows/remote-execution.md) for runner details.

## Prohibited actions

- Do not use this build-only route to run tests, coverage, E2E, or preflight.
- Under the root policy, a specific local preflight, coverage, or build target
  may be selected directly only when it is the smallest suitable diagnostic for
  the recorded task need. A selected Taskfile target may also execute its
  declared necessary prerequisites through that task; unrelated or broader
  targets and deployment remain prohibited locally.
- Do not use the exception for direct Docker/BuildKit control, direct cache
  operations or mutation, or daemon/container destruction.
- Do not treat `rust:ci`, `web:verify`, or `loom:verify` as build-only.
- Do not add an automatic dev-push slow pipeline.
- Do not create a custom scheduler or cancel runs outside native supersession.
- Do not replace missing remote evidence with local execution.

## Evidence

Capture source SHA, run, attempt, and result. Feature build success proves
compilation only. Return evidence through Team Gizmo (Delivery Pipeline context) to the
owning controller. The Feature Gizmo decides merge readiness; merge requires
the feature PR required checks and any separately scoped security acceptance
for the published feature head. Review and approval remain optional.
