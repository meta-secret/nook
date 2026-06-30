---
name: coding-bro
description: >-
  Default agent workflow for every coding task in this repository: fetch repo,
  branch from origin/main, implement the request, run local checks and tests,
  push, open PR, monitor CI, fix until green, squash merge. Always follow this
  pipeline for implementation work unless the user explicitly asks for a
  read-only or question-only answer.
---

# Coding Bro

**Default workflow for all implementation tasks.** System of record: [`.cortex/workflows/coding-bro.md`](../../.cortex/workflows/coding-bro.md).

Read [`.cortex/AGENTS.md`](../../.cortex/AGENTS.md) before starting. Follow the 0–9 steps in the cortex doc — fetch, branch, implement, local checks, push, PR, monitor, fix loop, squash merge, duration report.

## Quick reference

| Step | Action |
|------|--------|
| 0 | User prompt |
| 1 | `git fetch origin main` |
| 2 | `git checkout -b <branch> origin/main` |
| 3 | Implement |
| 4 | Minimum local checks (`task check` or scoped subset) |
| 5 | Commit → **push + open PR immediately** (parallel with optional e2e / `ci:pr`) |
| 6 | `gh pr checks --watch` + `gh pr merge --squash` |
| 7–9 | Fix loop until merged |

Full commands, e2e criteria, and non-negotiables: [`.cortex/workflows/coding-bro.md`](../../.cortex/workflows/coding-bro.md).
