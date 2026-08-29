# Review Request Workflow

## Overview

Review policy is explicit:

- Exact-head Cloud review settles before expensive repository-owned GitHub
  Actions begin, subject to a bounded timeout.
- Codex is the only automatic review provider. Do not activate Cursor Bugbot.
- A Codex eye reaction is liveness evidence only. It does not settle review and
  is never required for validation or readiness.
- Review is not a merge gate. A missing or unavailable review result does not
  delay delivery after those checks finish.
- Other external review services remain optional. Do not request or wait for
  Claude, CodeRabbit, or similar services unless the user explicitly asks.

## Prompt remote review after push

Do not require advisory local review before the first push or after a worker
handoff.

### Trusted automated publishers

The no-local-review rule applies to exactly two trusted GitHub Actions
publishers:

- `agent-implement.yml` formats, budget- and identity-validates, commits, and
  publishes an isolated implementation.
- `rust-dependency-updates.yml` runs required integrated dependency validation
  remotely inside trusted GitHub Actions before `task ci-agent:fix` with
  `CI_AGENT_FIX_PROFILE=rust-dependency-update` commits and publishes its
  isolated dependency-update branch.

Neither bounded editor has independent Git or external delivery authority.
Each publisher returns the exact published head directly to Gizmo. Gizmo then
owns continuing review, validation, readiness, and merge work.

### Ordinary worker handoff

For an ordinary worker handoff, once Gizmo integrates a coherent commit it runs
`task loom:pre-push`. Gizmo may commit deterministic integration-only state.
If hygiene mutates team-owned source or Cortex content, Gizmo returns that diff
to the responsible team for a fresh formatted commit, reintegrates it, and
reruns hygiene. Gizmo then promptly pushes the coherent head.

Every pushed head immediately selects remote evidence. Dispatch at least one
relevant focused `task remote` job when the head is not validation-ready.
Dispatch complete validation immediately when it is ready; focused jobs are
optional on that path.

Treat any actionable Cloud finding as normal correction work. Run pre-push
hygiene again before Gizmo pushes the replacement head.

## Complete validation and Cloud review

When the coherent head is ready, run complete validation:

```bash
task pr:validate PR=<number>
```

The command:

1. Requests one idempotent exact-head Codex review.
2. Backfills the trusted head boundary through default-branch workflow code
   when the pull request predates this protocol.
3. Waits for a clean result, current-head findings, or the bounded 600-second
   stabilization timeout.
4. Stops before validation when findings exist so the agent can address one
   coherent batch.
5. Opens a circuit breaker after three finding batches and requires a
   comprehensive stabilization pass. After resolving its coherent batch, the
   delivery owner explicitly acknowledges that pass with
   `REVIEW_CIRCUIT_BREAKER_ACKNOWLEDGED=1` on the next validation.
6. Rechecks that the PR head did not change, then dispatches repository-owned
   GitHub Actions.

Review unavailability does not deadlock validation: the bounded timeout allows
the checks to proceed. A liveness reaction does not end that wait.

Use `task pr:review PR=<number>` only when an exact-head review request is needed
without complete validation. It is idempotent and does not wait for a result.

## Actionable feedback priority

Before merge, inspect feedback currently present. Gizmo must coordinate these
actions:

- address every active actionable finding;
- reply on the targeted thread before resolving it;
- re-query until unresolved review threads are zero;
- keep polling feedback while repository checks run for the validation head; and
- interrupt obsolete check waiting when actionable feedback requires another
  push.

The actionable feedback queue has priority over waiting for checks.

When a new finding arrives:

1. Stop watching or cancel validation for the obsolete head when safe.
2. Dispatch the fix to the responsible team.
3. Integrate the verified fix commit.
4. Reply to and resolve the thread.
5. Run pre-push hygiene through the responsible formatter owner and push the
   replacement head.
6. Restart complete validation for that head. If it is not yet
   validation-ready, dispatch at least one relevant focused remote job first.

Use a focused task instead only when it isolates a known failure faster.

Only let exact-head validation finish while the actionable feedback queue is
empty. Feedback that arrives while checks run takes priority.

`task pr:ready` enforces unresolved-thread count alongside the exact-head
deployment, branch state, and applicable repository-owned PR checks. It reports
existing comments and reviews for inspection. It does not require a Codex
result and does not wait for one.

## Handling feedback that already exists

Before merge or handoff, inspect the PR comments, submitted review bodies, and
inline threads that are currently present. Follow
[the code-review-comments skill](../dynamic-skills/code-review-comments.md) for
every active actionable finding, whether it came from a human, Codex, Claude,
Cursor, CodeRabbit, or another service:

1. Verify the finding against the current branch and `.cortex` rules.
2. Dispatch the minimal correct fix to the responsible team, or document why
   no change is needed.
3. Integrate the verified fix commit.
4. Run `task loom:pre-push` through the responsible formatter owner, commit,
   and push when files changed.
5. If the head is not validation-ready, dispatch at least one relevant focused
   hosted task.
6. If complete validation was already requested, restart it for the replacement
   head. This first stabilizes one exact-head Codex review. Otherwise start it
   when that head is ready for the final gate.
7. Reply on the original thread or comment with the fix and validation when a
   targeted reply is possible.
8. Resolve only after the targeted reply is visible and the finding is fixed or
   explicitly invalidated.
9. Re-query feedback throughout validation and immediately before handoff or
   merge.

Inspect every external-service review comment already present. An optional
review service never makes its delivered feedback optional; classify
non-actionable status/praise as no action and fully handle every substantive
finding.

After those items are handled, rerun the feedback query immediately before
merge. If another actionable comment arrives while the agent is working,
address it. When repository-owned checks finish and no review feedback is
present, continue to readiness without waiting.

Gizmo routes every implementation finding to the responsible team. Gizmo does
not implement the fix. A separately requested service may own a finding only
when its team task contract grants the required scope.

## Handoff

Report:

- every actionable finding that was already present and how it was handled;
- unresolved active review-thread count at the time of the final inspection;
- Loom pre-push and optional debug results when used; and
- the state of Nook's applicable repository-owned PR test checks.

Confirm that unresolved review-thread count was zero at the final readiness
audit.

## Integrated verdict

Gizmo issues the final integrated PR verdict for the exact head.

- Required team verdicts remain independent acceptance evidence.
- A required blocking team verdict remains binding until that team clears it.
- A required blocking security verdict remains binding until security clears
  it.
- Gizmo cannot waive, downgrade, or override either block.
- Gizmo may block the PR when integration evidence is incomplete.
- A replacement head invalidates verdicts whose evidence is not head-stable.
