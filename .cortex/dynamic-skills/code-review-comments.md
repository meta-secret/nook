# Code Review Comments

## Purpose

Make review-comment handling auditable: every active CodeRabbit actionable item
must be verified, fixed or explicitly invalidated, and replied to on GitHub.
Resolvable review threads must also be resolved after the reply is posted.

## Problem Pattern

Agents sometimes inspect only inline review threads and miss CodeRabbit's PR
timeline/summary comments, including outside-diff-range comments, nitpicks, and
collapsed "actionable comments posted" sections. Agents also sometimes fix a
CodeRabbit comment in code and resolve the conversation without leaving a reply,
or resolve stale-looking comments without documenting why they no longer apply.
That hides review reasoning from the PR timeline and makes later agents
re-discover the same context.

## Preferred Pattern

Treat all CodeRabbit feedback surfaces as a checklist: inline review threads and
PR timeline/summary comments. For each active, non-outdated actionable item,
verify the finding against current code, use the included AI-agent prompt as
review context, make the minimal correct fix or write down why no change is
needed, validate locally, push the result, and leave a concise GitHub reply. If
the item has a resolvable review thread, resolve it only after the reply is
posted. If the item appears only in a PR timeline/summary comment, reply on the
PR timeline and reference the item.

## Scope

Applies to:

- Pull requests in this repository.
- CodeRabbit review threads.
- CodeRabbit PR timeline/summary comments, including outside-diff-range
  comments, nitpicks, and collapsed actionable-comment sections.
- Any equivalent automated review feedback with a concrete actionable finding.

Does not apply to:

- Already-resolved review threads.
- Outdated threads that are clearly addressed by a later commit, except when the
  PR still shows them as unresolved; in that case, reply with the addressing
  commit/context before resolving.
- Non-actionable summaries, praise, or status-only bot messages.

## Examples

- Before: fix code, push, call `resolveReviewThread`, no comment.
- After: fix code, push, reply "Fixed by moving the parser check into Rust and
  validated with `cargo test -p nook-core parser_conflict`.", then resolve.
- Before: resolve an outdated formatting comment because it looks obsolete.
- After: reply "This was addressed by commit `<sha>`; current file is
  formatter-clean.", then resolve.
- Before: query only unresolved review threads and miss CodeRabbit's "outside
  diff range comments" section in a PR timeline comment.
- After: inspect CodeRabbit issue comments too, add each actionable summary item
  to the checklist, fix or explain it, then reply on the PR timeline if no
  review thread exists.

## Application Checklist

- [ ] Fetch active PR review threads with `gh` and filter unresolved threads.
- [ ] Fetch CodeRabbit PR timeline/summary comments and expand actionable
      sections such as outside-diff-range comments and nitpicks.
- [ ] Build a checklist item for each active, non-outdated actionable thread or
      summary item.
- [ ] Verify each finding against current code before editing.
- [ ] Use CodeRabbit's AI-agent prompt as context, not as a blind patch.
- [ ] Make the minimal correct fix, or prepare a concise no-change rationale.
- [ ] Run the smallest relevant local validation, plus broader checks for risky
      changes.
- [ ] Push the fix or rationale commit when code/docs changed.
- [ ] Leave a GitHub reply explaining the fix, validation, or no-change
      rationale: on the review thread when one exists, otherwise on the PR
      timeline referencing the CodeRabbit item.
- [ ] Resolve the GitHub conversation after the reply is visible when the item
      has a resolvable thread.
- [ ] Re-query unresolved review threads and CodeRabbit timeline comments before
      final handoff.

## Validation

Use GraphQL or `gh pr view`/`gh api` to confirm there are no unresolved review
threads, and inspect CodeRabbit PR timeline comments for any remaining
actionable sections. Report the PR check state, unresolved-thread query result,
and whether CodeRabbit timeline comments contain unresolved actionable items in
the handoff.
