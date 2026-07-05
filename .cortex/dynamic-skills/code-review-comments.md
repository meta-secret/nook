# Code Review Comments

## Purpose

Make PR review-comment handling auditable: every active actionable item from a
human reviewer, CodeRabbit, or another automated reviewer must be verified, fixed
or explicitly invalidated, and replied to on GitHub. Agents must leave their own
reply before resolving any PR comment or review conversation. For CodeRabbit
threads, agents must not manually resolve after replying; wait for CodeRabbit to
mark/close the thread, then re-query.

## Problem Pattern

Agents sometimes inspect only inline review threads and miss PR timeline/summary
comments, including CodeRabbit outside-diff-range comments, nitpicks, and
collapsed "actionable comments posted" sections. Agents also sometimes fix a PR
comment in code and resolve the conversation without leaving their own reply, or
resolve stale-looking comments without documenting why they no longer apply.
Agents may also mistake CodeRabbit's automatic "addressed in commit" marker for
their own required reply. That hides review reasoning from the PR timeline and
makes later agents re-discover the same context.

## Preferred Pattern

Treat all actionable PR feedback surfaces as a checklist: inline review threads
and PR timeline/summary comments. For each active, non-outdated actionable item,
verify the finding against current code, use reviewer-provided AI-agent prompts
as review context, make the minimal correct fix or write down why no change is
needed, validate locally, push the result, and leave a concise GitHub reply. If
the item is a CodeRabbit review thread, wait for CodeRabbit to mark it addressed
or close it after the targeted reply; do not call `resolveReviewThread` manually.
For human or non-CodeRabbit threads, resolve only after the targeted reply is
posted and resolution is the correct next action. If the item appears only in a
PR timeline/summary comment, reply on the PR timeline and reference the item,
URL, or CodeRabbit `cr-comment` id.
CodeRabbit's automatic status text is useful context, but it does not satisfy the
agent-reply requirement. A broad PR audit comment also does not satisfy the
requirement; the reply must target the particular review thread, comment, or
summary item.

## Scope

Applies to:

- Pull requests in this repository.
- Human PR review comments and conversations.
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

- Before: fix code, push, call `resolveReviewThread`, no agent reply.
- After: fix code, push, reply to the specific thread: "Fixed by moving the
  parser check into Rust and validated with `cargo test -p nook-core parser_conflict`."
  If it is a CodeRabbit thread, wait for CodeRabbit to mark/close it; for human
  review threads, resolve only after the reply when appropriate.
- Before: resolve an outdated formatting comment because it looks obsolete.
- After: reply "This was addressed by commit `<sha>`; current file is
  formatter-clean.", then resolve.
- Before: query only unresolved review threads and miss CodeRabbit's "outside
  diff range comments" section in a PR timeline comment.
- After: inspect CodeRabbit issue comments too, add each actionable summary item
  to the checklist, fix or explain it, then reply with the exact CodeRabbit
  comment URL and `cr-comment` id if no review thread exists.
- Before: rely on CodeRabbit's appended "addressed in commit" marker and resolve
  the thread without saying anything.
- After: leave an agent reply with the addressing commit and validation, then
  wait for CodeRabbit's addressed/closing reply and re-query the thread.
- Before: leave one generic "CodeRabbit reply audit" PR comment summarizing all
  review surfaces.
- After: reply to each specific review thread, or for unthreaded summary items
  leave targeted PR comments that identify the original CodeRabbit comment URL,
  file/item title, and `cr-comment` id.

## Application Checklist

- [ ] Fetch active PR review threads with `gh` and filter unresolved threads.
- [ ] Fetch human and bot PR timeline comments and identify actionable items.
- [ ] Fetch CodeRabbit PR timeline/summary comments and expand actionable
      sections such as outside-diff-range comments and nitpicks.
- [ ] Build a checklist item for each active, non-outdated actionable thread or
      summary item.
- [ ] Verify each finding against current code before editing.
- [ ] Use reviewer-provided AI-agent prompts as context, not as blind patches.
- [ ] Make the minimal correct fix, or prepare a concise no-change rationale.
- [ ] Run the smallest relevant local validation, plus broader checks for risky
      changes.
- [ ] Push the fix or rationale commit when code/docs changed.
- [ ] Leave a GitHub reply explaining the fix, validation, or no-change
      rationale: on the review thread when one exists, otherwise as a targeted
      PR timeline reply referencing the exact review item, original comment URL,
      file/item title, and CodeRabbit `cr-comment` id.
- [ ] For CodeRabbit review summaries that do not create resolvable threads,
      leave targeted PR timeline replies for the specific actionable item or a
      tightly grouped set from the same CodeRabbit summary comment. Do not use a
      broad/general audit comment as the reply.
- [ ] For CodeRabbit review threads, do not manually resolve; wait for
      CodeRabbit's addressed/closing reply and re-query the thread state.
- [ ] For human or non-CodeRabbit review threads, resolve the GitHub
      conversation only after the agent's targeted reply is visible and
      resolution is the correct next action.
- [ ] Re-query unresolved review threads and CodeRabbit timeline comments before
      final handoff.

## Validation

Use GraphQL or `gh pr view`/`gh api` to confirm there are no unresolved review
threads, and inspect PR timeline comments for any remaining actionable items.
Report the PR check state, unresolved-thread query result, and whether timeline
comments contain unresolved actionable items in the handoff.
