# External Review Feedback Workflow

The exact-head Codex review is a required settlement gate for Nook pull requests.
Claude, Cursor, CodeRabbit, and other external services remain optional.

## Exact-head settlement rule

After each final push, run:

```bash
task pr:review PR=<number>
```

The idempotent request is tied to the PR head SHA. Wait until Codex submits a
review for that SHA or reacts with thumbs up to the request. Agents must:

- address every active actionable finding;
- reply on the targeted thread before resolving it;
- re-query until unresolved review threads are zero; and
- request another exact-head Codex review after any feedback fix changes the SHA.

`task pr:ready` enforces the settled Codex result and unresolved-thread count
alongside Nook's local validation and applicable repository-owned PR checks. Do
not use a fixed delay as a proxy for review completion. Other external services
are never waited on when they have not already supplied feedback.

## Handling feedback that already exists

Before merge or handoff, inspect the PR comments, submitted review bodies, and
inline threads that are currently present. Follow
[the code-review-comments skill](../dynamic-skills/code-review-comments.md) for
every active actionable finding, whether it came from a human, Codex, Claude,
Cursor, CodeRabbit, or another service:

1. Verify the finding against the current branch and `.cortex` rules.
2. Make the minimal correct fix or document why no change is needed.
3. Run the smallest relevant local validation.
4. Push the completed fix when files changed.
5. Reply on the original thread or comment with the fix and validation when a
   targeted reply is possible.
6. Resolve only after the targeted reply is visible and the finding is fixed or
   explicitly invalidated.
7. Re-query the feedback currently present once before handoff or merge.

Inspect every external-service review comment already present. An optional
review service never makes its delivered feedback optional; classify
non-actionable status/praise as no action and fully handle every substantive
finding.

After those items are handled, obtain the exact-head Codex result and rerun the
feedback query immediately before merge. If another actionable comment arrives
while the agent is working, address it. Do not wait for optional external
services other than the required Codex pass.

An external service may be asked to implement a finding only when the user
explicitly requests that separate service to own the fix. The active agent
otherwise handles findings directly.

## Handoff

Report:

- every actionable finding that was already present and how it was handled;
- unresolved active review-thread count at the time of the final inspection;
- local validation results; and
- the state of Nook's applicable repository-owned PR test checks.

Report whether the exact-head Codex request settled and confirm that unresolved
review-thread count was zero at the final readiness audit.
