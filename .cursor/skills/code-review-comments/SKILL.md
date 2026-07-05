---
name: code-review-comments
description: >-
  Use when addressing human, CodeRabbit, or automated PR review comments in
  Nook. Inspect inline review threads and PR timeline/summary comments, build a
  checklist from actionable items, verify each finding, fix or explain it,
  validate, push, reply on GitHub, then resolve resolvable conversations only
  after the agent's reply is visible.
---

# Code Review Comments

System of record: [`.cortex/dynamic-skills/code-review-comments.md`](../../../.cortex/dynamic-skills/code-review-comments.md).

Read [`.cortex/AGENTS.md`](../../../.cortex/AGENTS.md) before starting. Inspect
inline review threads and PR timeline/summary comments from humans, CodeRabbit,
and other automated reviewers, including outside-diff-range comments, nitpicks,
and collapsed actionable-comment sections. For every active, non-outdated
actionable item, verify the finding, use reviewer-provided AI-agent prompts as
context, make the minimal correct fix or document why no code change is needed,
validate locally, push any change, leave a concise GitHub reply on the review
thread or PR timeline, then resolve the conversation only when a resolvable
thread exists and the agent's reply is visible. Do not silently resolve review
conversations or ignore actionable summary comments.
