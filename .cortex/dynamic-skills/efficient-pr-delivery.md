# Efficient PR Delivery

## Purpose

Minimize agent wall time by batching feedback, parallelizing local and remote
validation, carrying ready PRs directly through squash merge, and stopping
implementation monitoring at that merge boundary.

## Problem Pattern

Agents repeatedly query PR/check state, serialize local and remote validation,
run full gates before inspecting feedback already present, or wait for optional
external reviewers. Moving `main`, unresolved-conversation policy, and
exact-head deployment requirements are then discovered only at merge time.

## Preferred Pattern

Run `task pr:preflight PR=<number>` as soon as a PR exists. Use focused checks
while editing, then commit and push the coherent iteration before starting the
long local gate. Inspect repository-owned checks directly while local validation
runs. The read-only `task pr:ready PR=<number>` audit may summarize exact-head
state, but it never performs a merge by itself.

Inspect feedback at the readiness boundary. A green audit is the task-owning
agent's signal to squash-merge immediately. A later push invalidates the audit.
The successful squash merge completes implementation delivery. Do not monitor
the resulting Main workflow or development deployment unless the user
explicitly requested deployment/live verification or assigned a Main failure.

## Scope

Applies to:

- Local and hosted agents shipping Nook pull requests.
- `agentic-ai/ci-agent`, `.task/agentic-ai.yml`, and PR workflow documentation.
- Repository-owned `PR` and path-applicable `Web research` workflows.

Does not apply to:

- Requesting or waiting for optional external AI review/check state.
- Replacing focused development tests with remote CI.
- Automatically classifying substantive review feedback as resolved.

## Examples

- Before: add a blind delay hoping an automatic review arrives.
- After: local validation runs alongside repository-owned workflows, then
  `task pr:ready PR=410` verifies the exact head without waiting for reviewers.
- Before: discover conversation-resolution and stale-base requirements after a
  failed merge command.
- After: `task pr:preflight PR=410` reports policy, base divergence, runs,
  deployments, and currently present feedback in JSON.

## Application Checklist

- [ ] Establish the branch and PR path from current `origin/main`.
- [ ] Run focused checks while iterating.
- [ ] Run `task format` unconditionally (host-applied) before every push; pass the UI demo contract when UI paths change.
- [ ] Commit and push before required full local validation.
- [ ] Inspect and address all feedback already present without waiting for reviewers.
- [ ] Run `task pr:ready` on the exact head.
- [ ] Squash-merge immediately when readiness succeeds, then report duration.
- [ ] Publish required stats-only bookkeeping without waiting for post-merge Main.

## Validation

Run `cd agentic-ai/ci-agent && npm test` and verify the read-only Task commands.
The readiness audit must reject stale heads, missing/failed Nook runs, missing
exact-head deployment, and feedback requiring handling. It must not wait for an
optional reviewer. The audit stays read-only; the task-owning agent performs the
squash merge after it succeeds.
