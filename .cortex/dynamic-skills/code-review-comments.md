# Code Review Comments

## Purpose

Make PR review-comment handling auditable: every active actionable item from a
human reviewer, Codex, or another automated reviewer must be verified, fixed or
explicitly invalidated, and replied to on GitHub. Agents must leave their own
targeted reply before resolving any PR comment or review conversation.

## Problem Pattern

Agents sometimes inspect only inline review threads and miss actionable findings
in a top-level review body. They also sometimes fix a finding in code and resolve
the conversation without documenting the fix and validation, or resolve a
stale-looking comment without recording why it no longer applies. That hides the
review reasoning from the PR timeline and makes later agents rediscover it.

## Preferred Pattern

Treat all actionable PR feedback surfaces as a checklist: inline review threads,
submitted review bodies, and human PR comments. For each active, non-outdated
actionable item, verify the finding against current code, use any
reviewer-provided agent prompt as context rather than a blind patch, make the
minimal correct fix or document why no change is needed, validate locally, and
push the result. Leave a concise reply on the original review thread or comment
when GitHub exposes a reply target. Resolve a conversation only after the
targeted reply is visible and the finding is fixed or explicitly invalidated.
If an actionable item appears only in a submitted review body without a threaded
reply target, include it in the local checklist and final handoff instead of
posting a broad or duplicative PR comment.

## Scope

Applies to:

- Pull requests in this repository.
- Human PR review comments and conversations.
- Codex review findings and submitted review bodies.
- Equivalent automated review feedback with a concrete actionable finding.

Does not apply to:

- Already-resolved review threads.
- Outdated threads that are clearly addressed by a later commit, except when the
  PR still shows them as unresolved; in that case, reply with the addressing
  commit/context before resolving.
- Non-actionable summaries, praise, or status-only bot messages.

## Examples

- Before: fix code, push, call `resolveReviewThread`, no agent reply.
- After: fix code, push, reply to the specific thread: "Fixed by moving the
  parser check into Rust and validated with `cd nook-app && cargo test -p nook-core parser_conflict`."
  Resolve only after that reply is visible.
- Before: resolve an outdated formatting comment because it looks obsolete.
- After: reply "This was addressed by commit `<sha>`; current file is
  formatter-clean.", then resolve.
- Before: inspect only unresolved inline threads and miss a P1 finding in the
  submitted Codex review body.
- After: inspect submitted reviews as well, add the finding to the checklist,
  fix or explain it, and report it in the handoff if no threaded target exists.
- Before: leave one generic "review audit" PR comment for several findings.
- After: reply only to the specific review threads/comments that support
  targeted replies and track unthreaded review-body items in the handoff.

## Application Checklist

- [ ] Fetch submitted reviews, active review threads, and PR comments with `gh`.
- [ ] Build a checklist item for each active, non-outdated actionable finding.
- [ ] Verify each finding against current code before editing.
- [ ] Use reviewer-provided agent prompts as context, not as blind patches.
- [ ] Make the minimal correct fix, or prepare a concise no-change rationale.
- [ ] Run the smallest relevant local validation, plus broader checks for risky
      changes.
- [ ] Push the fix or rationale commit when code/docs changed.
- [ ] Leave a GitHub reply explaining the fix, validation, or no-change
      rationale on the original review thread/comment when GitHub supports one.
- [ ] Resolve a GitHub conversation only after the targeted reply is visible and
      resolution is the correct next action.
- [ ] Track actionable submitted-review items without threaded reply targets in
      the local checklist and final handoff rather than creating comment spam.
- [ ] Re-query submitted reviews and unresolved review threads before handoff.

## Validation

Use GraphQL or `gh pr view`/`gh api` to confirm there are no unresolved review
threads, and inspect submitted reviews and PR comments for remaining actionable
items. Report the PR check state, unresolved-thread query result, and whether any
unthreaded actionable review-body item remains in the handoff.
