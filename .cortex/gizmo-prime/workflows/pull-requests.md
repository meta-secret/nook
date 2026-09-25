# Pull Requests

Complete the
[self-improvement review](../../teams/ai/dynamic-skills/self-improvement.md)
before readiness. No promotion is required when the evidence does not support
one.

Another active task's branch and pull request are read-only without an
explicit handoff.

## Required actions

- Create one pull request from each canonical feature branch into `main`.
- Run every required PR check for the current feature head.
- For direct remote execution, approved examples are
  `task remote TASK_NAME=web:build` and `task remote TASK_NAME=web:e2e`.
  Forward the requested selector directly without discovery, existence
  validation, or local preflight; use the terminal GitHub Actions outcome as
  execution evidence.
- Wait for the complete terminal check wave.
- When changing Main aggregation, validate the
  [producer and consumer failure gates](../../teams/sre/workflows/ci-pipeline.md)
  in hosted CI. Removing a status-only job must preserve its required assertion.
- Return every failed or cancelled required job before repair.
- Treat reviews and approvals as optional.
- Permit the owning Feature Gizmo to merge its own pull request.
- Use squash merge to preserve linear `main` history.
- Verify GitHub's actual merged state and the squash result on `origin/main`.
- Delete the remote feature branch after merge.

## Prohibited actions

- Do not use an integration `dev` branch.
- Do not create merge commits on `main`.
- Do not bypass required checks.
- Do not require an approval count.
- Do not force-push.
- Do not report a manually closed PR as merged.
