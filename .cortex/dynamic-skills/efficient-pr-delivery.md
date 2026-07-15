# Efficient PR Delivery

## Purpose

Minimize agent wall time by batching feedback, parallelizing final validation,
and delegating repository-check waiting to an event watcher instead of an
agent-owned polling loop.

## Problem Pattern

Agents repeatedly query PR/check state, serialize local and remote validation,
run full gates before inspecting feedback already present, or wait for Codex and
other external reviewers. Moving `main`, unresolved-conversation policy, and
exact-head deployment requirements are then discovered only at merge time.

## Preferred Pattern

Run `task pr:preflight PR=<number>` as soon as a PR exists. Use focused checks
while editing, then commit and push the coherent iteration before starting the
long local gate. Run local validation while `task pr:monitor PR=<number>` watches
only Nook's applicable repository-owned workflows. The monitor performs only a
bounded run-registration lookup; long-lived state tracking belongs to `gh run
watch`, so the agent wakes on workflow output/completion rather than polling the
API itself.

Inspect feedback that is already present exactly once at the readiness boundary.
Never request, poll, or wait for Codex Cloud or another external review, and do
not add a grace period for feedback that might arrive. Finish with `task
pr:ready PR=<number>` before squash merge.

## Scope

Applies to:

- Local and hosted agents shipping Nook pull requests.
- `agentic-ai/ci-agent`, `.task/agentic-ai.yml`, and PR workflow documentation.
- Repository-owned `PR` and path-applicable `Web research` workflows.

Does not apply to:

- Waiting for external AI review/check state.
- Replacing focused development tests with remote CI.
- Automatically classifying substantive review feedback as resolved.

## Examples

- Before: query `gh pr view` every 30 seconds and keep checking Codex status.
- After: `task pr:monitor PR=410` selects exact-head Nook runs and blocks on
  their event watcher; Codex is never selected.
- Before: discover conversation-resolution and stale-base requirements after a
  failed merge command.
- After: `task pr:preflight PR=410` reports policy, base divergence, runs,
  deployments, and currently present feedback in JSON.

## Application Checklist

- [ ] Establish the branch and PR path from current `origin/main`.
- [ ] Run focused checks while iterating.
- [ ] Commit and push before required full local validation.
- [ ] Run local validation and `task pr:monitor` concurrently.
- [ ] Inspect only feedback already present; never wait for new external review.
- [ ] Run `task pr:ready` on the exact head.
- [ ] Squash merge and report duration.

## Validation

Run `cd agentic-ai/ci-agent && npm test`, verify the Task commands with a live
PR, and confirm the monitor selects only repository-owned workflow names. The
readiness audit must reject stale heads, missing/failed Nook runs, missing
exact-head deployment, and feedback already requiring handling.
