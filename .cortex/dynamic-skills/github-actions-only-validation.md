# GitHub-Hosted Execution and Validation

## Purpose

Keep agent machines on the lightest possible local work.

Use GitHub-hosted runners for iterative builds/tests and complete merge
validation.

## Problem Pattern

Agents burn wall-clock and contend with other worktrees by running Docker builds
and tests locally.

Automatically starting the complete PR pipeline on every experimental push also
wastes hosted concurrency before the branch is ready.

## Preferred Pattern

**Required locally:** `task loom:pre-push` only.

**Iterative execution:** after pushing an exact branch head, run allowlisted
focused work with `task remote TASK_NAME=<name>`. Batch several commands with
`task remote TASK_NAMES=<name>,<name>`.

**Required remotely:** explicitly trigger complete exact-head PR validation.

Validate request example:

```yaml
prLand:
  validate:
    prNumber: 123
    runFullE2e: false
```

```bash
task loom:pre-push
git commit …
git push -u origin HEAD
task remote TASK_NAME=rust:test
task loom:pr-land CONFIG=/tmp/pr-land-validate.yaml
```

For Main-fix PRs, set `runFullE2e: true` in the `prLand.validate` request.

See [loom-tools.md](../references/loom-tools.md).

Expensive remote tasks and complete PR validation refresh their base branch and
refuse dispatch when the local head is stale.

Merge the reported `origin/<base>`, run `task loom:pre-push`, push, and retry.

On a red remote run: read `gh run view <id> --log-failed` → fix →
`task loom:pre-push` → commit → push → focused remote work or complete
validation again.

Ordinary pushes do not refresh complete PR checks.

## Scope

Applies to:

- Every normal implementation PR owned by an AI agent
- Coding-bro, pull-request, CI-pipeline, and quality workflow docs
- Pre-push hygiene and efficient PR delivery skills

Does not apply to:

- Humans who choose to run local mirrors for their own feedback
- Workbench issue, worklog, and statistics commits
- Read-only / question-only sessions with no commits
- Interactive development servers that require retained local state

## Examples

- Before: format → push → local `task check` while automatic PR CI consumes
  hosted workers.
- After: Loom pre-push → commit → push → focused `task remote` → Loom validate →
  Loom ready.
- Before: remote Verify fails → run full local `task ci:pr` before re-push.
- After: remote Verify fails → fix from logs → Loom pre-push → push → re-validate.

## Application Checklist

- [ ] Run `task loom:pre-push` unconditionally before every push.
- [ ] Do not require `task check`, `task ci:pr`, full suites, builds, or e2e
      on the agent machine.
- [ ] Use `task remote` for focused hosted iteration.
- [ ] Trigger complete validation explicitly with Loom or `task pr:validate`.
- [ ] Re-validate after every push that replaces the validated head.

## Validation

Proof is a PR whose first Verify attempt is not wasted on format/demo misses,
and whose complete validation was requested only for a ready head.
