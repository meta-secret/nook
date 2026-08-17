# GitHub-Hosted Execution and Validation

## Relationships

- [Cortex document navigation](cortex-document-map.md)
  - Defines the mandatory relationship and internal-map structure.
  - Apply whenever this skill card changes.
- [Cortex writer](cortex-writer.md)
  - Keeps the card and its navigation summaries concise.
  - Apply while editing or reviewing this guidance.
- [Cortex consistency](cortex-consistency.md)
  - Requires the card to agree with related guidance and current code.
  - Apply when rules, paths, commands, or examples change.
- [Loom tools](../references/loom-tools.md)
  - Defines the typed Loom requests used by hosted validation workflows.
  - Read when invoking or changing the validation entrypoints.

## Document map

- [Purpose](#purpose)
  - Explains why the skill exists and what invariant it protects.
  - Read first to decide whether the skill applies.
- [Problem Pattern](#problem-pattern)
  - Identifies the recurring rejected pattern and its warning signs.
  - Read while locating or reviewing violations.
- [Preferred Pattern](#preferred-pattern)
  - Defines the required structure or behavior.
  - Read before implementing a correction.
- [Scope](#scope)
  - Sets the applicable paths and explicit boundaries.
  - Read before expanding the task.
- [Examples](#examples)
  - Contrasts rejected and preferred forms.
  - Read when the rule needs a concrete illustration.
- [Application Checklist](#application-checklist)
  - Lists the steps needed to apply and maintain the skill.
  - Use during implementation and review.
- [Validation](#validation)
  - Names the smallest relevant mechanical and semantic proof.
  - Run before completing the task.

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

Validation has three layers:

- **Required locally:** run `task loom:pre-push` only.
- **Focused diagnosis:** after pushing an exact branch head, use
  `task remote TASK_NAME=<name>` only when one isolated gate gives faster
  feedback than complete validation.
  - Do not batch broad gates sequentially before complete validation.
- **Required remotely:** explicitly trigger complete exact-head PR validation.

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
task loom:pr-land CONFIG=path/to/agent-owned/pr-land-validate.yaml
```

- For Main-fix PRs, set `runFullE2e: true` in the `prLand.validate` request.
- See [Loom tools](../references/loom-tools.md).
- Expensive remote tasks and complete PR validation:
  - refresh their base branch; and
  - refuse dispatch when the local head is stale.
- When the head is stale:
  1. merge the reported `origin/<base>`;
  2. run `task loom:pre-push`;
  3. push; and
  4. retry.
- On a red remote run:
  1. read `gh run view <id> --log-failed`;
  2. fix the cause;
  3. run `task loom:pre-push`;
  4. commit and push; and
  5. use focused remote work or complete validation again.
- Ordinary pushes do not refresh complete PR checks.

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
- After: Loom pre-push → commit → push → Loom validate → Loom ready.
- Before: remote Verify fails → run full local `task ci:pr` before re-push.
- After: remote Verify fails → fix from logs → Loom pre-push → push → re-validate.

## Application Checklist

- [ ] Run `task loom:pre-push` unconditionally before every push.
- [ ] Do not require `task check`, `task ci:pr`, full suites, builds, or e2e
      on the agent machine.
- [ ] Use `task remote` only for focused diagnosis that shortens feedback time.
- [ ] Do not require focused tasks before complete validation.
- [ ] Trigger complete validation explicitly with Loom or `task pr:validate`.
- [ ] Re-validate after every push that replaces the validated head.

## Validation

Proof is a PR whose first Verify attempt is not wasted on format/demo misses,
and whose complete validation was requested only for a ready head.
