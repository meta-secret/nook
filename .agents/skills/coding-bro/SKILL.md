---
name: coding-bro
description: >-
  Default agent workflow for every coding task in this repository: fetch repo,
  publish a public-safe task plan to Workbench before implementation, branch
  from origin/main, implement, always host-apply task format (and the UI demo
  contract when UI paths change), commit and push/open the PR, run focused
  allowlisted tasks on GitHub-hosted workers, then explicitly trigger complete
  exact-head PR validation; on failure fix from CI logs, format, push, and
  trigger again until Nook's PR checks are green, resolve every actionable comment already present
  without waiting for reviewers, then squash merge; afterward publish the issue
  update, linked worklog, and PR statistics to Nook Workbench. Always follow this
  pipeline for implementation work unless the user explicitly asks for a
  read-only or question-only answer.
---

# Coding Bro

**Default workflow for all implementation tasks.** System of record: [`.cortex/workflows/coding-bro.md`](../../.cortex/workflows/coding-bro.md).

Read [`.cortex/AGENTS.md`](../../.cortex/AGENTS.md) before starting. Follow the steps in the cortex doc — fetch, publish the Workbench task plan before implementation, branch, implement, **always `task loom:pre-push`**, commit and push, use `task remote` for focused hosted execution, run `task loom:pr-land` / `task pr:validate` when the head is ready, address and resolve every actionable comment already present, fix loop until exact-head checks are green, squash merge, publish the Workbench issue update/linked worklog/statistics, and report duration. Never request or wait for external reviews/checks. Never run heavy product work locally.

## Quick reference

| Step | Action |
|------|--------|
| 0 | Interpret the request; never copy the raw prompt |
| 1 | `git fetch origin main` |
| 2 | Publish `plans/<feature>/<timestamp>-<task>.md`, then branch from `origin/main` |
| 3 | Implement the published plan |
| 4 | **Always** `task loom:pre-push` |
| 5 | Commit + push/open or update PR |
| 6 | Run focused `task remote` jobs as useful; then `task loom:pr-land ARGS='validate --pr <n>'` |
| 7 | Watch exact-head repository-owned checks and inspect feedback already present |
| 8–10 | On failure: CI logs → fix → `task loom:pre-push` → commit/push → focused remote proof → explicit validation |
| 11 | `gh pr merge --squash` when repository checks are green, threads are resolved, and Loom/Task readiness succeeds |
| 12 | Publish the issue update, plan-linked worklog, and Loom AI-agent stats to Nook Workbench; open a separate normal performance PR for actionable waste/regression |
| 13 | Duration report |

Pre-push format/demo rules: [`.cortex/dynamic-skills/pre-push-hygiene.md`](../../.cortex/dynamic-skills/pre-push-hygiene.md).

Hosted execution and validation: [`.cortex/workflows/remote-execution.md`](../../.cortex/workflows/remote-execution.md).

Full commands, e2e helpers, and non-negotiables: [`.cortex/workflows/coding-bro.md`](../../.cortex/workflows/coding-bro.md).
