---
name: coding-bro
description: >-
  Default agent workflow for every coding task in this repository: fetch repo,
  branch from origin/main, implement, run minimum local checks, push and open PR,
  monitor CI; on failure run full task ci:pr locally until green then push again;
  fix loop until remote green, squash merge. Always follow this pipeline for
  implementation work unless the user explicitly asks for a read-only or
  question-only answer.
---

# Coding Bro

**Default workflow for all implementation tasks.** System of record: [`.cortex/workflows/coding-bro.md`](../../.cortex/workflows/coding-bro.md).

Read [`.cortex/AGENTS.md`](../../.cortex/AGENTS.md) before starting. Follow the 0–9 steps in the cortex doc — fetch, branch, implement, minimum local checks, push/PR, monitor, full local loop on failure, squash merge, duration report.

## Quick reference

| Step | Action |
|------|--------|
| 0 | User prompt |
| 1 | `git fetch origin main` |
| 2 | `git checkout -b <branch> origin/main` |
| 3 | Implement |
| 4 | `task check` (minimum — must finish before push) |
| 5 | Push + open PR immediately (optional e2e / `ci:pr` in parallel) |
| 6 | `gh pr checks --watch` |
| 7–8 | On failure: logs → fix → `task ci:pr` loop until green → push → watch |
| 9 | `gh pr merge --squash` when remote green + duration report |

Full commands, e2e helpers, and non-negotiables: [`.cortex/workflows/coding-bro.md`](../../.cortex/workflows/coding-bro.md).
