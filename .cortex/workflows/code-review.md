# External Review Feedback Workflow

External AI review is optional, non-blocking feedback for Nook pull requests.
Codex, Claude, Cursor, CodeRabbit, and other services are never required gates.

## Non-blocking rule

Applicable repository-owned PR test checks are the only remote checks agents
wait for: normally `PR / Verify and preview`, plus `Web research / Build and
deploy research catalog` when web-research paths change. Agents must never:

- request `@codex review` or request a review from another external service;
- poll or monitor an external review or check;
- wait for a review to start, finish, or run again after a push;
- delay merge or handoff for an external status, deployment, or service; or
- add a grace period in case external feedback might arrive.

Automatic external reviews may remain enabled as a source of useful comments,
but their absence, pending state, failure, or lack of a second pass has no effect
on readiness. Nook's own local validation and applicable repository-owned PR test checks
remain authoritative.

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

After those existing items are handled, proceed based on Nook's own PR test
checks. Do not wait for an external reply, resolution, re-review, or new comment.
If another actionable comment arrives while the agent is still working, address
it; comments that have not arrived cannot block the workflow.

An external service may be asked to implement a finding only when the user
explicitly requests that separate service to own the fix. The active agent
otherwise handles findings directly and never waits for the service.

## Handoff

Report:

- every actionable finding that was already present and how it was handled;
- unresolved active review-thread count at the time of the final inspection;
- local validation results; and
- the state of Nook's applicable repository-owned PR test checks.

Do not report external review completion as a requirement and do not delay the
handoff to obtain it.
