# Efficient PR Delivery

## Purpose

Minimize agent wall time by batching feedback, parallelizing local and remote
validation, and carrying ready PRs directly through squash merge.

## Problem Pattern

Agents repeatedly query PR/check state, serialize local and remote validation,
run full gates before inspecting feedback already present, or wait for Codex and
other external reviewers. Moving `main`, unresolved-conversation policy, and
exact-head deployment requirements are then discovered only at merge time.

## Preferred Pattern

Run `task pr:preflight PR=<number>` as soon as a PR exists. Use focused checks
while editing, then commit and push the coherent iteration before starting the
long local gate. Inspect repository-owned checks directly while local validation
runs. The read-only `task pr:ready PR=<number>` audit may summarize exact-head
state, but it never performs a merge by itself.

Inspect feedback at the readiness boundary. A green audit is the task-owning
agent's signal to squash-merge immediately. A later push invalidates the prior
readiness result and requires a fresh audit before merge.

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
- After: local validation runs alongside the repository-owned PR workflows;
  `task pr:ready PR=410` provides a read-only exact-head snapshot.
- Before: discover conversation-resolution and stale-base requirements after a
  failed merge command.
- After: `task pr:preflight PR=410` reports policy, base divergence, runs,
  deployments, and currently present feedback in JSON.

## Application Checklist

- [ ] Establish the branch and PR path from current `origin/main`.
- [ ] Run focused checks while iterating.
- [ ] Commit and push before required full local validation.
- [ ] Inspect only feedback already present; never wait for new external review.
- [ ] Run `task pr:ready` on the exact head.
- [ ] Squash-merge immediately when readiness succeeds, then report duration.

## Validation

Run `cd agentic-ai/ci-agent && npm test` and verify the read-only Task commands.
The readiness audit must reject stale heads, missing/failed Nook runs, missing
exact-head deployment, and feedback already requiring handling. The audit stays
read-only; the task-owning agent performs the squash merge after it succeeds.
