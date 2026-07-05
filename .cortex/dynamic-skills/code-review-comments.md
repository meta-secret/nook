# Code Review Comments

## Purpose

Make review-comment handling auditable: every active CodeRabbit thread must be
verified, fixed or explicitly invalidated, replied to on GitHub, and resolved.

## Problem Pattern

Agents sometimes fix a CodeRabbit comment in code and resolve the conversation
without leaving a reply, or resolve stale-looking comments without documenting
why they no longer apply. That hides review reasoning from the PR timeline and
makes later agents re-discover the same context.

## Preferred Pattern

Treat CodeRabbit threads as a checklist. For each active, non-outdated thread,
verify the finding against current code, use the included AI-agent prompt as
review context, make the minimal correct fix or write down why no change is
needed, validate locally, push the result, leave a concise GitHub reply on the
thread, then resolve the conversation.

## Scope

Applies to:

- Pull requests in this repository.
- CodeRabbit review threads and any equivalent automated review thread with a
  concrete file/line finding.

Does not apply to:

- Already-resolved review threads.
- Outdated threads that are clearly addressed by a later commit, except when the
  PR still shows them as unresolved; in that case, reply with the addressing
  commit/context before resolving.

## Examples

- Before: fix code, push, call `resolveReviewThread`, no comment.
- After: fix code, push, reply "Fixed by moving the parser check into Rust and
  validated with `cargo test -p nook-core parser_conflict`.", then resolve.
- Before: resolve an outdated formatting comment because it looks obsolete.
- After: reply "This was addressed by commit `<sha>`; current file is
  formatter-clean.", then resolve.

## Application Checklist

- [ ] Fetch active PR review threads with `gh` and filter unresolved threads.
- [ ] Build a checklist item for each active, non-outdated thread.
- [ ] Verify each finding against current code before editing.
- [ ] Use CodeRabbit's AI-agent prompt as context, not as a blind patch.
- [ ] Make the minimal correct fix, or prepare a concise no-change rationale.
- [ ] Run the smallest relevant local validation, plus broader checks for risky
      changes.
- [ ] Push the fix or rationale commit when code/docs changed.
- [ ] Leave a GitHub reply on the review thread explaining the fix,
      validation, or no-change rationale.
- [ ] Resolve the GitHub conversation after the reply is visible.
- [ ] Re-query unresolved review threads before final handoff.

## Validation

Use GraphQL or `gh pr view`/`gh api` to confirm there are no unresolved review
threads. Report the PR check state and unresolved-thread query result in the
handoff.
