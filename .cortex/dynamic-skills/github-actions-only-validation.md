# GitHub-Hosted Execution and Validation

## Purpose

Keep agent machines on the lightest possible local work and use GitHub-hosted
runners for both iterative builds/tests and complete merge validation.

## Problem Pattern

Agents burn wall-clock and contend with other worktrees by running Docker builds
and tests locally. Automatically starting the complete PR pipeline on every
experimental push also wastes hosted concurrency before the branch is ready.

## Preferred Pattern

**Required locally:** only `task format` (host-applied), plus the light UI demo
contract when UI-facing paths change.

**Iterative execution:** after committing and pushing an exact branch head, run
allowlisted focused jobs with `task remote TASK_NAME=<name>`.

**Required remotely:** explicitly trigger the complete exact-head PR workflow
with `task pr:validate PR=<number>`. For a Main-fix PR, use
`task pr:validate PR=<number> FULL_E2E=1`.

```bash
task format
git add -u
# When UI paths change vs origin/main:
#   git fetch origin main
#   .github/scripts/ui-demo-contract.sh "$(git rev-parse origin/main)"
git commit …
git push -u origin HEAD
task remote TASK_NAME=rust:test       # repeat focused hosted tasks as useful
task pr:validate PR=<number>          # spend the full PR pipeline when ready
```

On a red remote run: read `gh run view <id> --log-failed` (and app logs for
web/e2e) → fix → `task format` → commit → push → dispatch focused remote work
or complete validation again. Ordinary pushes do not refresh complete PR
checks.

## Scope

Applies to:

- Every normal implementation PR owned by an AI agent.
- Coding-bro, pull-request, CI-pipeline, and quality workflow docs.
- Pre-push hygiene and efficient PR delivery skills.

Does not apply to:

- Humans who choose to run local mirrors for their own feedback.
- Workbench issue, worklog, and statistics commits, which are not Nook product
  changes or Nook PRs.
- Read-only / question-only sessions with no commits.
- Interactive development servers and browser sessions that require retained
  local state.

## Examples

- Before: format → push → local `task check` while automatic PR CI consumes
  hosted workers.
- After: format → commit → push → focused `task remote` jobs → explicit
  `task pr:validate` → `task pr:ready`.
- Before: remote Verify fails → run full local `task ci:pr` before re-push.
- After: remote Verify fails → fix from logs → format → push → focused remote
  proof as useful → explicitly re-trigger complete validation.

## Application Checklist

- [ ] Run `task format` unconditionally before every push.
- [ ] Pass the UI demo contract when UI-facing paths changed.
- [ ] Do not require `task check`, `task ci:pr`, full suites, builds, or e2e
      on the agent machine.
- [ ] Commit and push the exact source before `task remote`.
- [ ] Use `task pr:validate` only when the head is ready for the complete gate.
- [ ] Use `FULL_E2E=1` when the PR repairs a Main failure.
- [ ] After every later push, trigger complete validation again.
- [ ] Merge only after green applicable Actions checks and `task pr:ready`.

## Validation

A first Verify attempt should not fail solely on Prettier/rustfmt/demo-contract
misses. Product correctness is proven by green applicable GitHub Actions on the
exact head, not by a local Docker mirror. See
[coding-bro.md](../workflows/coding-bro.md) and
[remote-execution.md](../workflows/remote-execution.md).
