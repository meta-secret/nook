---
name: coding-bro
description: >-
  Default agent workflow for every coding task in this repository: fetch repo,
  branch from origin/main, implement, commit and push/open the PR before required
  final local validation, then run local and applicable repository-owned PR
  checks in parallel (use e2e one spec at a time while debugging); on failure run
  full task ci:pr locally until green then push again; fix loop until Nook's PR
  checks are green, address comments already present without waiting for external
  reviews or checks, then squash merge. Always follow this
  pipeline for implementation work unless the user explicitly asks for a
  read-only or question-only answer.
---

# Coding Bro

**Default workflow for all implementation tasks.** System of record: [`.cortex/workflows/coding-bro.md`](../../.cortex/workflows/coding-bro.md).

Read [`.cortex/AGENTS.md`](../../.cortex/AGENTS.md) before starting. Follow the 0–10 steps in the cortex doc — fetch, branch, implement, commit and push when checkable, then run required local validation and applicable PR checks in parallel, address comments already present, full local loop on failure, squash merge, duration report. Never request, monitor, or wait for Codex or another external review/check.

## Quick reference

| Step | Action |
|------|--------|
| 0 | User prompt |
| 1 | `git fetch origin main` |
| 2 | `git checkout -b <branch> origin/main` |
| 3 | Implement |
| 4 | Commit + push/open or update PR **before required final checks** |
| 5 | Immediately run local validation in parallel with PR workflows — `task check`; `task ci:pr` when web flows change |
| 6 | Watch only applicable repository-owned checks: `PR / Verify and preview`, plus `Web research / Build and deploy research catalog` for web-research paths; never request or wait for an external review/check |
| 7–9 | On failure: logs → fix (single-spec e2e) → `task ci:pr` loop until green → push → address actionable comments currently present → re-watch only Nook's PR check |
| 10 | `gh pr merge --squash` when Nook's applicable PR test checks are green + duration report |

Full commands, e2e helpers, and non-negotiables: [`.cortex/workflows/coding-bro.md`](../../.cortex/workflows/coding-bro.md).
