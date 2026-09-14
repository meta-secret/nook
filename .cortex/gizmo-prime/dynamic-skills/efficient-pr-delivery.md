# Efficient PR Delivery

## Purpose

Use [dev delivery](../architecture/dev-delivery.md) to separate fast feature
feedback from the manually operated slow dev PR cycle.

## Required actions

1. Integrate complete scoped Team Agent commits into the feature worktree.
2. Push the feature and route the remote build-only request through Delivery
   Pipeline Team Gizmo -> active harness -> PR Lifecycle Agent.
3. Route the feature review packet through Delivery Pipeline Team Gizmo -> active
   harness -> PR Lifecycle Agent. The Feature Gizmo decides the review state.
4. Repair accepted findings through the same team path.
5. Authorize Delivery Pipeline Team Gizmo to route the local-integration packet
   through active harness -> PR Lifecycle Agent after the final feature SHA
   compiles.
6. Let the dev manager select the next snapshot publication snapshot.
7. Route the full existing slow PR checks for that frozen SHA through Delivery
   Pipeline Team Gizmo -> active harness -> PR Lifecycle Agent.
8. Delegate failures back to feature Gizmos.
9. Authorize Delivery Pipeline Team Gizmo to route guarded fast-forward
   promotion through active harness -> PR Lifecycle Agent only after complete
   acceptance.

The Feature Gizmo owns feature delivery state. The Dev Manager owns dev PR
policy, readiness, and promotion policy. Team Gizmo and PR Lifecycle Agent do
only packetized mechanics. They never create or update PRs or decide policy.

## Prohibited actions

- Do not run local tests, product builds, Docker work, or broad pre-push gates.
- Do not run tests, coverage, e2e, or preflight at the feature stage.
- Do not publish dev from feature work.
- Do not cancel slow checks already running or create a custom polling loop.
- Do not squash, rebase, or replace fast-forward promotion with a merge commit.

## Evidence

Keep feature compilation, local integration, published snapshot, and promotion
SHAs distinct. Follow [PR metadata](../workflows/pull-requests.md#pr-title-and-description)
and preserve actual review/security verdicts. Type safety does not replace
authored behavior tests or their slow-stage execution.
