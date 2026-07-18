---
name: coding-bro
description: >-
  Default agent workflow for every coding task in this repository: fetch repo,
  branch from origin/main, implement, commit and push/open the PR before required
  final local validation, then run local and applicable repository-owned PR
  checks in parallel (use e2e one spec at a time while debugging); on failure run
  full task ci:pr locally until green then push again; fix loop until Nook's PR
  checks are green, settle the exact-head Codex pass, resolve every actionable
  comment, then squash merge; afterward publish and analyze the PR statistics in
  a separate check-free stats-only PR. Always follow this
  pipeline for implementation work unless the user explicitly asks for a
  read-only or question-only answer.
---

# Coding Bro

**Default workflow for all implementation tasks.** System of record: [`.cortex/workflows/coding-bro.md`](../../.cortex/workflows/coding-bro.md).

Read [`.cortex/AGENTS.md`](../../.cortex/AGENTS.md) before starting. Follow the 0–12 steps in the cortex doc — fetch, branch, implement, commit and push when checkable, then run required local validation and applicable PR checks in parallel, request the exact-head Codex pass, address and resolve every actionable comment, full local loop on failure, squash merge, publish/analyze the stats-only PR, and report duration. Never wait for other optional external reviews/checks.

## Quick reference

| Step | Action |
|------|--------|
| 0 | User prompt |
| 1 | `git fetch origin main` |
| 2 | `git checkout -b <branch> origin/main` |
| 3 | Implement |
| 4 | Commit + push/open or update PR **before required final checks** |
| 5 | Immediately run local validation in parallel with PR workflows — `task check`; `task ci:pr` when web flows change |
| 6 | Watch applicable repository-owned checks and run `task pr:review PR=<number>` for the exact head; never wait for other optional external reviews/checks |
| 7–9 | On failure: logs → fix (single-spec e2e) → `task ci:pr` loop until green → push → request a new Codex pass → address and resolve actionable comments |
| 10 | `gh pr merge --squash` when repository checks and the exact-head Codex pass are green, threads are resolved, and `task pr:ready` succeeds |
| 11 | Publish, analyze, and immediately squash-merge `.stats/ai-agent/<pr>.yaml`; open a separate normal performance PR for actionable waste/regression |
| 12 | Duration report |

Full commands, e2e helpers, and non-negotiables: [`.cortex/workflows/coding-bro.md`](../../.cortex/workflows/coding-bro.md).
