# Review Request Workflow

## Overview

Review policy is explicit:

- Repository-owned GitHub Actions dispatch before any Cloud-review wait.
- Exact-head Cloud review proceeds during the hosted validation window.
- Codex is the only automatic review provider. Do not activate Cursor Bugbot.
- A Codex eye reaction is liveness evidence only. It does not settle review and
  is never required for validation or readiness.
- Review findings remain actionable before merge.
- Other external review services remain optional. Do not request or wait for
  Claude, CodeRabbit, or similar services unless the user explicitly asks.

## Prompt remote review after push

Do not require advisory local review before the first push or after a worker
handoff.

### Trusted automated publishers

The no-local-review rule applies to the two trusted GitHub Actions publishers
named in the root [team worker contract](../../AGENTS.md#team-worker-contract).
Neither bounded editor has independent Git or external delivery authority.
Each publisher returns the exact published head to Gizmo, which owns review,
validation, readiness, and merge.

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

1. Dispatches repository-owned GitHub Actions immediately.
2. Requests the trusted exact-head transition backfill, checks the review
   circuit, and only then contacts Codex without waiting.
3. Rechecks that the PR head and base did not change during dispatch.
4. Lets hosted checks and exact-head review proceed concurrently.
5. Batches current review findings and failed checks after both settle.
6. Opens a circuit breaker after three finding batches and requires a
   comprehensive stabilization pass. After resolving its coherent batch, the
   delivery owner explicitly acknowledges that pass with
   `REVIEW_CIRCUIT_BREAKER_ACKNOWLEDGED=1` before the next review collection.

The trusted head-transition request always precedes Codex contact. The
non-waiting request then checks the circuit. An open circuit suppresses the
request but does not stop already-dispatched validation. A transient request
failure or provider `requested: false` result reports `not-requested` and also
leaves validation running. Collect or retry review separately; do not restart
hosted validation merely because the review request was unavailable.

Never run `task pr:review:stabilize` before hosted validation dispatch. It may
collect a pending review only after dispatch while checks are already running.

Use `task pr:review PR=<number>` only when an exact-head review request is needed
without complete validation. It is idempotent and does not wait for a result.

## Actionable feedback priority

Before merge, inspect feedback currently present. Gizmo must coordinate these
actions:

- address every active actionable finding;
- reply on the targeted thread before resolving it;
- re-query until unresolved review threads are zero;
- keep polling feedback while repository checks run for the validation head;
  and
- batch feedback with check failures after both result sets settle.

Do not replace an in-flight validation head merely because review arrives
first. Collect the complete coherent repair batch unless a security finding
requires immediate fail-closed action.

When a new finding arrives:

1. For a security finding, fail closed and stop or cancel unsafe validation.
2. For every other finding, keep the in-flight validation head running until
   hosted checks and exact-head review settle.
3. Combine review findings and failed checks into one coherent repair batch.
4. Dispatch that batch to the responsible team.
5. Integrate the verified fix commit, then reply to and resolve the thread.
6. Run pre-push hygiene through the responsible formatter owner and push the
   replacement head.
7. Restart complete validation for that head. If it is not yet
   validation-ready, dispatch at least one relevant focused remote job first.

Use a focused task instead only when it isolates a known failure faster.

Non-security feedback that arrives while checks run joins the pending repair
batch. It does not cancel validation or replace the head before both result
sets settle.

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
6. If complete validation was already requested, dispatch it for the
   replacement head first and collect exact-head Codex review concurrently.
   Otherwise start it when that head is ready for the final gate. In both cases,
   wait for both result sets before forming another repair batch.
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
