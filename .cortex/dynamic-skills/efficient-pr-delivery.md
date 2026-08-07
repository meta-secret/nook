# Efficient PR Delivery

## Purpose

Minimize agent wall time by formatting locally, using focused GitHub-hosted
tasks while iterating, explicitly spending the complete PR pipeline only on a
ready head, and carrying ready PRs directly through squash merge.

## Problem Pattern

Agents repeatedly query PR/check state, serialize or duplicate local and remote
validation, run full local gates before inspecting feedback already present, or
wait for optional external reviewers.

Moving `main`, unresolved-conversation policy, and exact-head deployment
requirements are then discovered only at merge time.

## Preferred Pattern

```bash
task loom:pre-push
git commit …
git push -u origin HEAD
task remote TASK_NAME=<name>   # focused iteration
task loom:pr-land ARGS='validate --pr <number>'
task loom:pr-land ARGS='ready --pr <number>'
gh pr merge <number> --squash
```

Do not run `task check` / `task ci:pr` as a local product gate.

`task loom:pr-land ARGS='merge-check --pr <n>'` summarizes readiness.

Loom never squash-merges. The task-owning agent merges after readiness succeeds.

Inspect feedback at the readiness boundary.

A later push invalidates the audit.

Do not monitor the resulting Main workflow unless the user explicitly requested
deployment or Main-failure work.

## Scope

Applies to:

- Local and hosted agents shipping Nook pull requests
- `agentic-ai/loom`, `agentic-ai/ci-agent`, `.task/agentic-ai.yml`
- Repository-owned `PR` and path-applicable `Web research` workflows

Does not apply to:

- Requesting or waiting for optional external AI review
- Replacing GitHub Actions with a required local product gate
- Automatically classifying substantive review feedback as resolved

## Examples

- Before: format → push → `task check` ‖ PR CI → merge after both green.
- After: `task loom:pre-push` → push → focused remote → Loom validate/ready →
  squash merge.
- Before: discover stale-base requirements after a failed merge command.
- After: `task pr:preflight` / Loom ready reports the blocker before merge.

## Application Checklist

- [ ] Establish the branch and PR path from current `origin/main`.
- [ ] Run `task loom:pre-push` before every push.
- [ ] Commit and push; use focused hosted tasks instead of a local product gate.
- [ ] Trigger complete PR validation explicitly on the ready head.
- [ ] Inspect and address all feedback already present.
- [ ] Run `task loom:pr-land ARGS='ready --pr <n>'` on the exact head.
- [ ] Squash-merge immediately when readiness succeeds, then report duration.
- [ ] Publish Workbench issue, worklog, and Loom AI-agent statistics.

## Validation

Run `task loom:test` and `cd agentic-ai/ci-agent && npm test`.

The readiness audit must reject stale heads, missing/failed Nook runs, missing
exact-head deployment, and feedback requiring handling.

The audit stays read-only.

The task-owning agent performs the squash merge after it succeeds.
