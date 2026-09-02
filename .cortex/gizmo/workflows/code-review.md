# Review Request Workflow

## Overview

Review policy is explicit:

- Repository-owned GitHub Actions dispatch before any Cloud-review wait.
- Exact-head Cloud review proceeds during the hosted validation window.
- Codex is the only automatic review provider. Do not activate Cursor Bugbot.
- A Codex eye reaction is liveness evidence only. It does not settle review and
  is never required for validation or readiness.
- Every substantive review finding requires a disposition before merge.
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

For an ordinary worker handoff, once Gizmo continues from a coherent commit it runs
`task loom:pre-push`. Gizmo may commit parent-owned delivery state.
If hygiene mutates team-owned source or Cortex content, Gizmo returns that diff
to the responsible team for a fresh formatted commit, continues from it, and
reruns hygiene. Gizmo then promptly pushes the coherent head.

Every pushed head immediately selects remote evidence. Dispatch at least one
relevant focused `task remote` job when the head is not validation-ready.
Dispatch complete validation immediately when it is ready; focused jobs are
optional on that path.

Record a disposition for every substantive Cloud finding. Treat only an
accepted finding as correction work. Run pre-push hygiene again before Gizmo
pushes the replacement head.

## Complete validation and Cloud review

When the coherent head is ready, run complete validation:

```bash
task pr:validate PR=<number>
```

The command:

1. Dispatches repository-owned GitHub Actions immediately.
2. Freezes the current PR head and base only to bind the review request to the
   intended revision.
   - Inspects every PR comment, submitted review body, and review thread without
     filtering by timestamp, marker, or head transition.
   - Deletes retired GitHub Actions exact-head boundary notices before feedback
     classification.
   - Fails feedback inspection when a retired notice cannot be deleted.
   - Detects revision changes through feedback inspection and immediately
     before Codex contact.
   - Checks the review circuit, then contacts Codex without waiting for a result.
3. Rechecks that the PR head and base did not change during dispatch.
4. Lets hosted checks and exact-head review proceed concurrently.
5. Batches current review findings and failed checks after both settle.
6. Opens a circuit breaker after three finding batches and requires a
   comprehensive stabilization pass. After resolving its coherent batch, the
   delivery owner explicitly acknowledges that pass with
   `REVIEW_CIRCUIT_BREAKER_ACKNOWLEDGED=1` before the next review collection.

If the frozen revision changes, the review request fails truthfully without
contacting Codex, while validation continues. The non-waiting request then
checks the circuit. An open circuit
suppresses the request but does not stop validation. A transient request failure
or provider `requested: false` result reports `not-requested` and also leaves
validation running. Collect or retry review separately; do not restart hosted
validation merely because the review request was unavailable.

Never run `task pr:review:stabilize` before hosted validation dispatch. It may
collect a pending review only after dispatch while checks are already running.

Use `task pr:review PR=<number>` only when an exact-head review request is needed
without complete validation. It is idempotent and does not wait for a result.

## Actionable feedback priority

Before merge, inspect feedback currently present. Preserve the repository's
broader use of `actionable`. A review finding requires implementation only
after its defect claim passes validity and current-task relevance. Rejecting a
reviewer-proposed remedy does not erase an accepted defect. Follow the
[code-review-comments skill](../dynamic-skills/code-review-comments.md). Gizmo
must coordinate these actions:

- obtain an evidence-backed disposition for every substantive PR comment and
  submitted review finding, including feedback created before the current
  head;
- record the defect-claim disposition separately from the disposition of any
  reviewer-proposed remedy;
- implement the smallest correct fix for every accepted defect, including when
  its proposed remedy is rejected;
- record why each rejected defect claim requires no current change;
- keep every clarification-needed finding unresolved and readiness-blocking
  until evidence supports accepted or rejected reclassification;
- retain every substantive top-level PR comment in inspection output;
- minimize a handled top-level PR comment with GitHub's `RESOLVED` classifier;
- block readiness on every substantive top-level comment that is not minimized
  as `RESOLVED`;
- retain every substantive submitted review body in inspection output;
- block readiness on a substantive review body when it has no inline comments;
- use unresolved-thread state as the deterministic readiness authority when a
  review has inline comments;
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
3. Dispatch each finding to the responsible team for separate defect and
   remedy dispositions.
4. Combine accepted defects and failed checks into one coherent repair batch.
5. Record evidence-backed no-change dispositions for rejected defect claims.
6. Keep clarification-needed findings unresolved until the team obtains the
   missing evidence and reclassifies them as accepted or rejected.
7. Determine whether an accepted fix or failed-check repair changed the head.
8. When the head changed, continue from the verified fix commit. Run pre-push
   hygiene through the responsible formatter owner and push the replacement
   head.
9. When the head changed, restart complete validation for that head. If it is
   not yet validation-ready, dispatch at least one relevant focused remote job
   first.
10. When the batch is rejected-only, reply with the no-change rationale and
    resolve the explicitly invalidated threads without replacement-head work.
11. Reply to clarification-needed findings with the missing evidence and keep
    them unresolved without replacement-head work.

A confirmed security or authority violation is binding and fails closed. Route
it to the authorized owner when its correction exceeds the current task scope.
Do not downgrade it into an optional or out-of-scope enhancement.

### Validation-head handling

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
every active substantive finding, whether it came from a human, Codex, Claude,
Cursor, CodeRabbit, or another service:

1. Verify the finding against the current branch and `.cortex` rules.
2. Apply validity and current-task relevance gates to the defect claim.
3. Select a candidate for the smallest correct in-scope fix for an accepted
   defect.
4. Apply the proportionality and scope gate separately to any proposed remedy
   and the candidate correction.
5. Dispatch the candidate correction after it passes that gate, even when the
   proposed remedy is rejected.
6. Document the evidence-backed no-change disposition for a rejected defect
   claim.
7. Keep a clarification-needed finding unresolved until evidence supports
   accepted or rejected reclassification.
8. Determine whether an accepted fix or failed-check repair changed the head.
9. When the head changed, continue from the verified fix commit. Run
   `task loom:pre-push PR=<number>` through the responsible formatter owner,
   commit, and push the replacement head.
10. When the head changed and is not validation-ready, dispatch at least one
   relevant focused hosted task.
11. When complete validation was already requested for a changed head,
    dispatch it for the replacement head first and collect exact-head Codex
    review concurrently. Otherwise start it when that changed head is ready for
    the final gate. Wait for both result sets before forming another repair
    batch.
12. Do not run commit, push, or replacement-head validation when the batch has
    no accepted fix or failed-check repair.
13. Reply on the original thread or comment with the disposition, evidence, fix,
   and validation as applicable when a
   targeted reply is possible.
14. Resolve only after the targeted reply is visible and the finding is fixed or
   explicitly invalidated.
15. Re-query feedback throughout validation and immediately before handoff or
   merge.

Do not resolve or minimize a clarification-needed finding as handled. Its
targeted response requests or identifies the missing evidence. The finding
remains readiness-blocking until reclassification.

Inspect every external-service review comment already present. An optional
review service never makes its delivered feedback optional; classify
non-actionable status or praise as no action. Record a disposition for every
substantive finding. Do not treat a technically plausible edge case,
enhancement, hardening idea, or new functionality outside the PR acceptance
boundary as a command to expand the change. Do not create speculative
follow-up work or an issue without explicit user authority.

### Completion and ownership

After those items are handled, rerun the feedback query immediately before
merge. If another substantive comment arrives while the agent is working,
record its separate defect and remedy dispositions. Implement the smallest
correct fix only when the defect is accepted. When repository-owned checks
finish and no review feedback is present, continue to readiness without
waiting.

Gizmo routes every implementation finding to the responsible team. Gizmo does
not implement the fix. A separately requested service may own a finding only
when its team task contract grants the required scope.

## Handoff

Report:

- every substantive finding that was already present and its disposition;
- unresolved active review-thread count at the time of the final inspection;
- Loom pre-push and optional debug results when used; and
- the state of Nook's applicable repository-owned PR test checks.

Confirm that unresolved review-thread count was zero at the final readiness
audit.

## Exact-head verdict

Gizmo issues the final PR verdict for the exact head.

- Required team verdicts remain independent acceptance evidence.
- A required blocking team verdict remains binding until that team clears it.
- A required blocking security verdict remains binding until security clears
  it.
- Gizmo cannot waive, downgrade, or override either block.
- Gizmo may block the PR when exact-head evidence is incomplete.
- A replacement head invalidates verdicts whose evidence is not head-stable.
