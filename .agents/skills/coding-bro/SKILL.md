---
name: coding-bro
description: >-
  Default agent workflow for every coding task in this repository: fetch repo,
  publish a public-safe task plan to Workbench before implementation, branch
  from origin/main, implement, always host-apply task format (and the UI demo
  contract when UI paths change), commit and push/open the PR, run focused
  allowlisted tasks on GitHub-hosted workers, then explicitly trigger complete
  exact-head PR validation; on failure fix from CI logs, format, push, and
  trigger again until Nook's PR checks are green, resolve every actionable comment already present,
  then squash merge; afterward publish the issue
  update, linked worklog, and PR statistics to Nook Workbench. Always follow this
  pipeline for implementation work unless the user explicitly asks for a
  read-only or question-only answer.
---

# Coding Bro

**Default workflow for all implementation tasks.** System of record: [`.cortex/workflows/coding-bro.md`](../../.cortex/workflows/coding-bro.md).

Read [`.cortex/AGENTS.md`](../../.cortex/AGENTS.md) before starting.

Follow the delivery sequence in the cortex workflow:

1. Fetch and publish the Workbench task plan.
2. Branch, implement, and run `task loom:pre-push`.
3. Commit and run advisory local Codex review.
4. Push and use focused hosted execution when useful.
5. Trigger complete validation and exact-head Cloud review through Loom.
6. Resolve actionable feedback while repository-owned checks run.
7. Fix until exact-head checks and readiness pass.
8. Squash-merge and publish the Workbench completion records.
9. Report duration.

Never wait for a Codex result after repository-owned checks finish. Do not
request other external reviews or checks. Never run heavy product work locally.

Before any mutation, apply
[agent-feature-ownership](../agent-feature-ownership/SKILL.md). Work only on the
current task's assigned feature and focused issues. Treat every other active
task as read-only unless an explicit handoff transfers ownership.

Before implementation, estimate authored changed lines and identify the owning
module or layer. Target no more than 5,000 authored changed lines per PR. Split
larger features into ordered Workbench issues and independently mergeable PRs.
Continue through every slice until the complete feature is delivered. Full
contract:
[`.cortex/workflows/pull-requests.md`](../../../.cortex/workflows/pull-requests.md#pull-request-size-and-modularity).

## Quick reference

| Step | Action |
|------|--------|
| 0 | Interpret the request; never copy the raw prompt |
| 1 | `git fetch origin main` |
| 2 | Publish `plans/<feature>/<timestamp>-<task>.md`, then branch from `origin/main` |
| 3 | Implement the published plan |
| 4 | **Always** `task loom:pre-push` |
| 5 | Commit; run local review; then push/open or update PR. For a harness PR, run local review immediately after handoff |
| 6 | Run focused `task remote` jobs as useful; then `task loom:pr-land CONFIG=<pr-land-validate-request.yaml>` to dispatch validation and request review |
| 7 | Watch exact-head repository-owned checks and inspect feedback already present |
| 8–10 | On failure: CI logs → fix → `task loom:pre-push` → commit/push → focused remote proof → explicit validation |
| 11 | `gh pr merge --squash` when repository checks are green, threads are resolved, and Loom/Task readiness succeeds |
| 12 | Publish the issue update, plan-linked worklog, and Loom AI-agent stats to Nook Workbench; open a separate normal performance PR for actionable waste/regression |
| 13 | Duration report |

Pre-push format/demo rules: [`.cortex/dynamic-skills/pre-push-hygiene.md`](../../.cortex/dynamic-skills/pre-push-hygiene.md).

Hosted execution and validation: [`.cortex/workflows/remote-execution.md`](../../.cortex/workflows/remote-execution.md).

Full commands, e2e helpers, and non-negotiables: [`.cortex/workflows/coding-bro.md`](../../.cortex/workflows/coding-bro.md).
