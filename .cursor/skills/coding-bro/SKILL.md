---
name: coding-bro
description: >-
  Default agent workflow for every coding task in this repository: fetch repo,
  branch from origin/main, implement, always host-apply task format (and the UI
  demo contract when UI paths change), commit and push/open the PR, then monitor
  applicable repository-owned PR checks on GitHub Actions (no required local
  task check / ci:pr); on failure fix from CI logs, format, and push again until
  Nook's PR checks are green, resolve every actionable comment already present
  without waiting for reviewers, then squash merge; afterward publish and analyze
  the PR statistics in a separate check-free stats-only PR. Always follow this
  pipeline for implementation work unless the user explicitly asks for a
  read-only or question-only answer.
---

# Coding Bro

**Default workflow for all implementation tasks.** System of record: [`.cortex/workflows/coding-bro.md`](../../.cortex/workflows/coding-bro.md).

Read [`.cortex/AGENTS.md`](../../.cortex/AGENTS.md) before starting. Follow the steps in the cortex doc — fetch, branch, implement, **always `task format`**, commit and push when checkable, monitor applicable PR checks on GitHub Actions only, address and resolve every actionable comment already present, fix loop until green, squash merge, publish/analyze the stats-only PR, and report duration. Never request or wait for external reviews/checks. Never require local `task check` / `task ci:pr` for merge.

## Quick reference

| Step | Action |
|------|--------|
| 0 | User prompt |
| 1 | `git fetch origin main` |
| 2 | `git checkout -b <branch> origin/main` |
| 3 | Implement |
| 4 | **Always** `task format` (+ UI demo contract when UI paths change) → `git add -u` |
| 5 | Commit + push/open or update PR |
| 6 | Monitor applicable repository-owned PR workflows on GitHub Actions |
| 7 | Watch applicable repository-owned checks and inspect feedback already present; never request or wait for external reviews/checks |
| 8–10 | On failure: CI logs → fix (optional single-spec e2e) → `task format` → push → address and resolve actionable comments |
| 11 | `gh pr merge --squash` when repository checks are green, threads are resolved, and `task pr:ready` succeeds |
| 12 | Publish, analyze, and immediately squash-merge `.stats/ai-agent/<pr>.yaml`; open a separate normal performance PR for actionable waste/regression |
| 13 | Duration report |

Pre-push format/demo rules: [`.cortex/dynamic-skills/pre-push-hygiene.md`](../../.cortex/dynamic-skills/pre-push-hygiene.md).

GitHub Actions-only product gates: [`.cortex/dynamic-skills/github-actions-only-validation.md`](../../.cortex/dynamic-skills/github-actions-only-validation.md).

Full commands, e2e helpers, and non-negotiables: [`.cortex/workflows/coding-bro.md`](../../.cortex/workflows/coding-bro.md).
