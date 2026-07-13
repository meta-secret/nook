---
name: coding-bro
description: >-
  Default agent workflow for every coding task in this repository: fetch repo,
  branch from origin/main, implement, validate locally (prefer cached Docker over
  cold GH Actions; run e2e one spec at a time while debugging), push and open PR
  when ready, monitor only Nook's repository-owned PR test check; on failure run
  full task ci:pr locally until green then push again; fix loop until Nook's PR
  check is green, address comments already present without waiting for external
  reviews or checks, then squash merge. Always follow this
  pipeline for implementation work unless the user explicitly asks for a
  read-only or question-only answer.
---

# Coding Bro

**Default workflow for all implementation tasks.** System of record: [`.cortex/workflows/coding-bro.md`](../../.cortex/workflows/coding-bro.md).

Read [`.cortex/AGENTS.md`](../../.cortex/AGENTS.md) before starting. Follow the 0–10 steps in the cortex doc — fetch, branch, implement, push when ready, local validation (prefer local Docker; e2e one spec at a time while debugging), monitor only Nook's PR test check, address comments already present, full local loop on failure, squash merge, duration report. Never request, monitor, or wait for Codex or another external review/check.

## Quick reference

| Step | Action |
|------|--------|
| 0 | User prompt |
| 1 | `git fetch origin main` |
| 2 | `git checkout -b <branch> origin/main` |
| 3 | Implement |
| 4 | Push + open PR **when locally ready** (GH Actions validates, not discovers) |
| 5 | Local validation — `task check`; debug e2e with `E2E_SPEC=… task web:test:e2e:file`; `task ci:pr` when web flows change |
| 6 | Watch only the repository-owned `PR / Verify and preview` check; never request or wait for an external review/check |
| 7–9 | On failure: logs → fix (single-spec e2e) → `task ci:pr` loop until green → push → address actionable comments currently present → re-watch only Nook's PR check |
| 10 | `gh pr merge --squash` when Nook's PR test check is green + duration report |

Full commands, e2e helpers, and non-negotiables: [`.cortex/workflows/coding-bro.md`](../../.cortex/workflows/coding-bro.md).
