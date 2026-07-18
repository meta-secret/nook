# Efficient PR Delivery

## Purpose

Minimize agent wall time by batching feedback, parallelizing local and remote
validation, and carrying ready PRs directly through squash merge.

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

Inspect feedback at the readiness boundary and run `task pr:review PR=<number>`
for the exact head. A green audit is the task-owning agent's signal to
squash-merge immediately. A later push invalidates both the prior review result
and readiness audit.

## Scope

Applies to:

- Local and hosted agents shipping Nook pull requests.
- `agentic-ai/ci-agent`, `.task/agentic-ai.yml`, and PR workflow documentation.
- Repository-owned `PR` and path-applicable `Web research` workflows.

Does not apply to:

- Waiting for optional external AI review/check state other than the required
  exact-head Codex result.
- Replacing focused development tests with remote CI.
- Automatically classifying substantive review feedback as resolved.

## Examples

- Before: add a blind delay hoping an automatic review arrives.
- After: local validation runs alongside repository-owned workflows, then
  `task pr:review PR=410` requests an exact-head result and `task pr:ready`
  verifies it.
- Before: discover conversation-resolution and stale-base requirements after a
  failed merge command.
- After: `task pr:preflight PR=410` reports policy, base divergence, runs,
  deployments, and currently present feedback in JSON.

## Application Checklist

- [ ] Establish the branch and PR path from current `origin/main`.
- [ ] Run focused checks while iterating.
- [ ] Commit and push before required full local validation.
- [ ] Request and settle the exact-head Codex review; inspect all feedback present.
- [ ] Run `task pr:ready` on the exact head.
- [ ] Squash-merge immediately when readiness succeeds, then report duration.

## Validation

Run `cd agentic-ai/ci-agent && npm test` and verify the read-only Task commands.
The readiness audit must reject stale heads, missing/failed Nook runs, missing
exact-head deployment, an unsettled Codex result, and feedback requiring handling. The audit stays
read-only; the task-owning agent performs the squash merge after it succeeds.
