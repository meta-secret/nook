# Review Request Workflow

## Overview

Exact-head Cloud review runs alongside repository-owned GitHub Actions.

Codex is the first reviewer. When Codex reports that it cannot review, the
same `task pr:review` request switches to Cursor Bugbot.

Review is not a merge gate. A missing or unavailable review result does not
delay delivery after those checks finish.

Other external review services remain optional. Do not request or wait for
Claude, CodeRabbit, or similar services unless the user explicitly asks.

## Local review before the first owner-authored push

Run the advisory local review on a coherent branch head:

```bash
task pr:review-local
```

The command compares the branch with current `origin/main`.

If the Codex CLI or authentication is unavailable, it reports the skip and
does not block delivery. There is no headless Cursor review CLI. Cloud review
later requests Cursor Bugbot when Codex reports a usage limit.

Treat any actionable finding local review does produce as normal
implementation work. Run pre-push hygiene again after fixes.

The bounded implementation worker cannot run Git. The harness commits and
pushes its result after the worker exits. For that path, the continuing owner
runs local review immediately after handoff. This is the only first-push
exception.

## Complete validation and Cloud review

When the coherent head is ready, run complete validation:

```bash
task pr:validate PR=<number>
```

The command:

1. Immediately dispatches repository-owned GitHub Actions.
2. Rechecks that the PR head did not change after dispatch.
3. Attempts one idempotent, exact-head Cloud review request.

That review request prefers Codex. After a fresh Codex comment, it probes
briefly for a Codex usage-limit reply. If that exact-head Codex request already
has a usage-limit reply, or the probe sees one, it posts `cursor review`
instead of retrying Codex. A later head tries Codex first again.

Review-request failure does not fail validation. Do not wait for a result.

Use `task pr:review PR=<number>` only when an exact-head review request is needed
without complete validation. It is idempotent and does not wait for a result.

## Actionable feedback priority

Before merge, inspect feedback currently present. Agents must:

- address every active actionable finding;
- reply on the targeted thread before resolving it;
- re-query until unresolved review threads are zero;
- keep polling feedback while repository checks run for the validation head; and
- interrupt obsolete check waiting when actionable feedback requires another
  push.

The actionable feedback queue has priority over waiting for checks.

When a new finding arrives:

1. Stop watching or cancel validation for the obsolete head when safe.
2. Make the fix.
3. Reply to and resolve the thread.
4. Run pre-push hygiene.
5. Push the replacement head.
6. Restart complete validation for that head.

Use a focused task instead only when it isolates a known failure faster.

Only let exact-head validation finish while the actionable feedback queue is
empty. Feedback that arrives while checks run takes priority.

`task pr:ready` enforces unresolved-thread count alongside the exact-head
deployment, branch state, and applicable repository-owned PR checks. It reports
existing comments and reviews for inspection. It does not require a Codex or
Cursor result and does not wait for one. A Cursor Bugbot disabled-account
upsell comment is status. It is not a finding.

## Handling feedback that already exists

Before merge or handoff, inspect the PR comments, submitted review bodies, and
inline threads that are currently present. Follow
[the code-review-comments skill](../dynamic-skills/code-review-comments.md) for
every active actionable finding, whether it came from a human, Codex, Claude,
Cursor, CodeRabbit, or another service:

1. Verify the finding against the current branch and `.cortex` rules.
2. Make the minimal correct fix or document why no change is needed.
3. Run `task loom:pre-push` when files changed.
4. Commit and push the completed fix.
5. Use focused hosted tasks as useful.
6. If complete validation was already requested, restart it for the replacement
   head. This also requests exact-head Cloud review. Otherwise start it when
   that head is ready for the final gate.
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

An external service may be asked to implement a finding only when the user
explicitly requests that separate service to own the fix. The active agent
otherwise handles findings directly.

## Handoff

Report:

- every actionable finding that was already present and how it was handled;
- unresolved active review-thread count at the time of the final inspection;
- Loom pre-push and optional debug results when used; and
- the state of Nook's applicable repository-owned PR test checks.

Confirm that unresolved review-thread count was zero at the final readiness
audit.
