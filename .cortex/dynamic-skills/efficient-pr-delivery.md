# Efficient PR Delivery

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
  - Defines the typed PR-land and audit requests used during delivery.
  - Read when invoking or changing Loom delivery entrypoints.

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

Minimize agent wall time by formatting locally, using focused GitHub-hosted
tasks while iterating, explicitly spending the complete PR pipeline only on a
ready head, and carrying ready PRs directly through squash merge.

## Problem Pattern

Agents waste delivery time when they:

- repeatedly query PR or check state;
- serialize or duplicate local and remote validation;
- run full local gates before review feedback; or
- spend the complete pipeline on a head that Codex immediately asks them to change.

Moving `main`, unresolved-conversation policy, and exact-head deployment
requirements are then discovered only at merge time.

## Preferred Pattern

Write `prLand` domain requests as nested YAML (for example `prLand.validate` with `prNumber`).

```bash
task loom:pre-push
git commit …
task pr:review-local
git push -u origin HEAD
task remote TASK_NAME=<name>   # focused iteration
task loom:pr-land CONFIG=path/to/agent-owned/pr-land-validate.yaml
task loom:pr-land CONFIG=path/to/agent-owned/pr-land-ready.yaml
gh pr merge <number> --squash
```

See [loom-tools.md](../references/loom-tools.md).

Delivery rules:

- Do not run `task check` or `task ci:pr` as a local product gate.
- `task loom:pr-land CONFIG=<pr-land-merge-check-request.yaml>` summarizes
  readiness.
- Loom never squash-merges.
  - The task-owning agent merges after readiness succeeds.
- Loom dispatches complete validation and then requests exact-head Codex review.
  - A failed request or missing result is non-blocking.
- Inspect feedback again at the readiness boundary.
- A later push invalidates the audit.
- Do not monitor the resulting Main workflow unless the user explicitly
  requested deployment or Main-failure work.

## Scope

Applies to:

- Local and hosted agents shipping Nook pull requests
- `agentic-ai/loom`, `agentic-ai/ci-agent`, `.task/agentic-ai.yml`
- Repository-owned `PR` and path-applicable `Web research` workflows

Does not apply to:

- Waiting for Codex after repository-owned checks finish
- Requesting other optional external AI review
- Replacing GitHub Actions with a required local product gate
- Automatically classifying substantive review feedback as resolved

## Examples

- Before: format → push → `task check` ‖ PR CI → merge after both green.
- After: `task loom:pre-push` → local Codex review → push → focused remote →
  complete validation and Cloud review request → ready → squash merge.
- Before: discover stale-base requirements after a failed merge command.
- After: `task pr:preflight` / Loom ready reports the blocker before merge.

## Application Checklist

- [ ] Establish the branch and PR path from current `origin/main`.
- [ ] Run `task loom:pre-push` before every push.
- [ ] Commit the coherent formatted change.
- [ ] Run advisory `task pr:review-local` before the first owner-authored push.
- [ ] For a harness-created PR, run local review after handoff instead.
- [ ] Push; use focused hosted tasks instead of a local product gate.
- [ ] Dispatch complete validation and request exact-head review together.
- [ ] Inspect and address all feedback already present.
- [ ] Run `task loom:pr-land CONFIG=<pr-land-ready-request.yaml>` on the exact head.
- [ ] Squash-merge immediately when readiness succeeds, then report duration.
- [ ] Publish Workbench issue, worklog, and Loom AI-agent statistics.

## Validation

- Run `task loom:test` and `cd agentic-ai/ci-agent && npm test`.
- The readiness audit must reject:
  - stale heads;
  - missing or failed Nook runs;
  - missing exact-head deployment; and
  - feedback requiring handling.
- The audit stays read-only.
- The task-owning agent performs the squash merge after readiness succeeds.
