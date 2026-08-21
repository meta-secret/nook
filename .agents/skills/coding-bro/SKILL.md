---
name: coding-bro
description: >-
  Default agent workflow for every coding task in this repository: fetch repo,
  read owning product specs in .cortex/product-specs/ for product tasks,
  publish a public-safe task plan to Workbench before implementation, branch
  from origin/main, implement (and update specs on new product knowledge), always
  host-apply task format (and the UI demo contract when UI paths change), commit
  and push/open the PR, run focused allowlisted tasks on GitHub-hosted workers,
  then explicitly trigger complete exact-head PR validation; on failure fix from
  CI logs, format, push, and trigger again until Nook's PR checks are green,
  resolve every actionable comment already present, then squash merge; afterward
  publish the issue update, linked worklog, and PR statistics to Nook Workbench.
  Always follow this pipeline for implementation work unless the user explicitly
  asks for a read-only or question-only answer.
---

# Coding Bro

When delegating any part of this workflow outside a compiled Loom graph, follow
the `subagent-delegation` skill and finalize every reached attempt with
`task loom:agent-delegation:record REQUEST=<request.json>` before consuming its
semantic view.

**Default workflow for all implementation tasks.** System of record: [`.cortex/workflows/coding-bro.md`](../../.cortex/workflows/coding-bro.md).

Read [`.cortex/AGENTS.md`](../../.cortex/AGENTS.md) before starting.

Follow the delivery sequence in the cortex workflow:

1. Fetch repo, read owning product specs, and publish the Workbench task plan.
2. Branch and create ignored session memory for substantial work.
3. Apply [subagent-delegation](../subagent-delegation/SKILL.md) when delegating.
   Require attempt streams and recursive view aggregation before integration.
4. Implement, capture discoveries, update specs when justified, and run `task loom:pre-push`.
5. Commit and run advisory local Codex review.
6. Push and use focused hosted execution when useful.
7. Trigger complete validation and exact-head Cloud review through Loom.
8. Resolve actionable feedback while repository-owned checks run.
9. Fix until exact-head checks pass.
10. When session memory was created, reflect, promote durable knowledge, remove the file, and verify readiness.
11. Squash-merge and publish the Workbench completion records.
12. Report duration.

Never wait for a Codex or Cursor result after repository-owned checks finish.
`task pr:review` may request Cursor Bugbot when Codex reports a usage limit.
Do not request Claude, CodeRabbit, or other optional reviewers. Never run heavy
product work locally.

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

| Step | Action                                                                                                                                                          |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Interpret the request; read owning product spec in `.cortex/product-specs/` when product flows are touched; never copy the raw prompt                           |
| 1    | `git fetch origin main`                                                                                                                                         |
| 2    | Publish `plans/<feature>/<timestamp>-<task>.md`, then branch from `origin/main`                                                                                 |
| 3    | Create session memory for substantial work; implement the plan; capture discoveries; update product specs when justified                                     |
| 4    | **Always** `task loom:pre-push`                                                                                                                                 |
| 5    | Commit; run local review; then push/open or update PR. For a harness PR, run local review immediately after handoff                                             |
| 6    | Run focused `task remote` jobs as useful; then `task loom:pr-land CONFIG=<pr-land-validate-request.yaml>` to dispatch validation and request review             |
| 7    | Watch exact-head repository-owned checks and inspect feedback already present                                                                                   |
| 8–10 | On failure: CI logs → fix → `task loom:pre-push` → commit/push → focused remote proof → explicit validation                                                     |
| 11   | Reflect; promote durable knowledge; update the graph when needed; delete session memory; revalidate a changed head                                               |
| 12   | `gh pr merge --squash` when repository checks are green, threads are resolved, and Loom/Task readiness succeeds                                                 |
| 13   | Publish the issue update, plan-linked worklog, and Loom AI-agent stats to Nook Workbench; open a separate normal performance PR for actionable waste/regression |
| 14   | Duration report                                                                                                                                                 |

Pre-push format/demo rules: [`.cortex/dynamic-skills/pre-push-hygiene.md`](../../.cortex/dynamic-skills/pre-push-hygiene.md).

Hosted execution and validation: [`.cortex/workflows/remote-execution.md`](../../.cortex/workflows/remote-execution.md).

Full commands, e2e helpers, and non-negotiables: [`.cortex/workflows/coding-bro.md`](../../.cortex/workflows/coding-bro.md).
