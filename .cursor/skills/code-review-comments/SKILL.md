---
name: code-review-comments
description: >-
  Use when addressing CodeRabbit or automated PR review comments in Nook.
  Inspect inline review threads and PR timeline/summary comments, build a
  checklist from actionable items, verify each finding, fix or explain it,
  validate, push, reply on GitHub, then resolve resolvable conversations.
---

# Code Review Comments

System of record: [`.cortex/dynamic-skills/code-review-comments.md`](../../../.cortex/dynamic-skills/code-review-comments.md).

Read [`.cortex/AGENTS.md`](../../../.cortex/AGENTS.md) before starting. Inspect
both inline review threads and CodeRabbit PR timeline/summary comments,
including outside-diff-range comments, nitpicks, and collapsed actionable-comment
sections. For every active, non-outdated actionable item, verify the finding, use
the included AI-agent prompt as context, make the minimal correct fix or document
why no code change is needed, validate locally, push any change, leave a concise
GitHub reply on the review thread or PR timeline, then resolve the conversation
when a resolvable thread exists. Do not silently resolve review conversations or
ignore actionable summary comments.
