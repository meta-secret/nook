# External Review Feedback Workflow

Codex, Claude, Cursor, CodeRabbit, and all other external review services are
optional and non-blocking.

## Non-blocking review rule

Before merge, inspect feedback currently present. Agents must:

- address every active actionable finding;
- reply on the targeted thread before resolving it;
- re-query until unresolved review threads are zero;
- keep polling feedback while repository checks run after each push; and
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
empty.

`task pr:ready` enforces unresolved-thread count alongside the exact-head
deployment, branch state, and applicable repository-owned PR checks. It reports
existing comments and reviews for inspection but does not wait for an optional
reviewer to respond. Do not request an external review merely to satisfy a gate.

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
   head. Otherwise start it when that head is ready for the final gate.
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
address it. Do not wait for external review services.

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
