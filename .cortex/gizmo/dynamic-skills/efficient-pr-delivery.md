# Efficient PR Delivery

## Purpose

Minimize agent wall time with remote-first validation. Run only pre-push
hygiene locally, promptly publish each coherent head, and obtain exact-head
remote evidence immediately. A head that is not validation-ready requires at
least one relevant focused remote task. Dispatch complete validation
immediately when the head is validation-ready; focused tasks are optional on
that path.
Trusted Rust gates may use ARC while runtime-dependent gates remain hosted.

## Problem Pattern

Agents waste delivery time when they:

- repeatedly query PR or check state;
- serialize or duplicate local and remote validation;
- delay hosted validation while waiting for review feedback; or
- cancel in-flight validation solely because non-security review findings arrive.

Unresolved-conversation policy, exact-head deployment requirements, and the
distinction between a new PR head and a later `main` advance are then
discovered only at merge time.

## Preferred Pattern

Write `prLand` domain requests as nested YAML (for example `prLand.validate` with `prNumber`).

```bash
task loom:pre-push
git commit …
git push -u origin HEAD
# Required when the head is not validation-ready:
task remote TASK_NAME=<name>
# As soon as the head is validation-ready:
task loom:pr-land CONFIG=path/to/agent-owned/pr-land-validate.yaml
task loom:pr-land CONFIG=path/to/agent-owned/pr-land-ready.yaml
gh pr merge <number> --squash
```

See [Loom tools](../../teams/ai/references/loom-tools.md).

Create and refresh PR metadata using the exact
[title and description contract](../workflows/pull-requests.md#pr-title-and-description).
Do this at publication, after a material scope change, and before readiness or
handoff.

Delivery rules:

- Do not run `task check` or `task ci:pr` as a local product gate.
- Do not run broad local builds, tests, e2e, container product gates, advisory
  review, or duplicate hosted-check mirrors before push.
- Exactly two trusted GitHub Actions publishers bypass ordinary worker commit
  handoffs. See the root
  [team worker contract](../../AGENTS.md#team-worker-contract). Neither bounded
  editor has independent Git authority. Gizmo continues either published head
  without duplicate integration or advisory local review.
- `task loom:pr-land CONFIG=<pr-land-merge-check-request.yaml>` summarizes
  readiness.
- Loom never squash-merges.
  - Gizmo merges after readiness succeeds.
- Loom dispatches complete validation before any GitHub review wait.
  - It requests one exact-head Codex review without waiting.
  - Review and hosted checks proceed concurrently.
  - Current findings and failed checks become one repair batch.
  - Codex is the sole automatic provider. Cursor Bugbot remains inactive.
- Inspect feedback again at the readiness boundary.
- A later push invalidates the audit for that PR head.
- A later advance of `main` does not invalidate a successful exact-head audit
  by itself. The readiness audit still requires a mergeable PR, successful
  exact-head checks and deployment, and clean review state.
- Keep PR monitoring in the active task with bounded direct waits. Never create
  a Codex scheduled task, automation, heartbeat, reminder, or recurring
  follow-up to finish delivery later.
- Planning a bounded polling cadence is allowed as active-task execution
  behavior. Persisting that plan as Codex scheduling state is prohibited.
- Treat "merge when ready" as an instruction to test the PR, monitor its
  exact-head evidence, and merge in the same delivery task after readiness.
- Do not monitor the resulting Main workflow unless the user explicitly
  requested deployment or Main-failure work.
- Do not diagnose or repair unrelated default-branch health. Consult
  `origin/main` only for the PR's base and freshness requirements.

## Scope

Applies to:

- Local and hosted agents shipping Nook pull requests
- `agentic-ai/loom`, `agentic-ai/ci-agent`, `.task/agentic-ai.yml`
- Repository-owned `PR` and path-applicable `Web research` workflows

Does not apply to:

- Requesting another review after repository-owned checks finish
- Requesting Claude, CodeRabbit, or other optional external AI review
- Replacing GitHub Actions with a required local product gate
- Automatically classifying substantive review feedback as resolved

## Examples

- Before: format → push → `task check` ‖ PR CI → merge after both green.
- After when not ready: `task loom:pre-push` → commit and push → required
  relevant focused remote evidence.
- After when ready: immediate complete validation with concurrent exact-head
  Cloud review collection → one combined repair batch and readiness check →
  squash merge.
- Before: spend another full validation cycle only because `main` advanced
  after the PR checks passed.
- After: require a current base before starting expensive validation, then
  re-run readiness without rebasing when only `main` advanced afterward.

## Application Checklist

- [ ] Establish the branch and PR path from current `origin/main`.
- [ ] Apply the canonical PR title and description contract.
- [ ] Run `task loom:pre-push` before every push.
- [ ] Route formatter mutations in team-owned source or Cortex files back to
      that team for a fresh formatted commit.
- [ ] Commit only parent-owned delivery state as Gizmo.
- [ ] Promptly push without another local product or review gate.
- [ ] If the pushed head is not validation-ready, dispatch at least one
      relevant focused hosted task immediately.
- [ ] When the head is validation-ready, dispatch complete validation
      immediately without requiring a focused task first.
- [ ] Dispatch complete validation before any GitHub review wait.
- [ ] Collect exact-head review during hosted validation.
- [ ] Address current findings and failed checks as one coherent batch.
- [ ] Inspect and address all feedback already present.
- [ ] If `main` advanced after successful exact-head checks, re-run readiness
      without updating the PR branch solely for that base advance.
- [ ] After every replacement push, obtain fresh exact-head remote evidence.
- [ ] Promote an evidence-backed durable discovery when justified; no promotion
      is required when no candidate qualifies.
- [ ] If promotion changes the head, repeat hosted validation.
- [ ] Run `task loom:pr-land CONFIG=<pr-land-ready-request.yaml>` on the exact head.
- [ ] Squash-merge immediately when readiness succeeds, then report duration.
- [ ] Keep monitoring in the active task; do not schedule a Codex follow-up.
- [ ] Stop at the PR merge unless Main work was explicitly assigned.
- [ ] Publish Workbench issue, worklog, and agent statistics.

## Validation

- Run `task loom:test` and `cd agentic-ai/ci-agent && npm test`.
- The readiness audit must reject:
  - conflicting or unknown mergeability;
  - missing or failed Nook runs;
  - missing exact-head deployment; and
  - feedback requiring handling.
- The audit must expose a PR behind `main` as status without rejecting it
  solely for that reason when the other readiness conditions pass.
- Initial expensive validation still requires a current base before dispatch.
- The audit stays read-only.
- Gizmo performs the squash merge after readiness succeeds.
