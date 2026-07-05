---
name: code-review-comments
description: >-
  Use when addressing CodeRabbit or automated PR review comments in Nook. Build
  a checklist from unresolved threads, verify each finding, fix or explain it,
  validate, push, reply on the GitHub thread, then resolve the conversation.
---

# Code Review Comments

System of record: [`.cortex/dynamic-skills/code-review-comments.md`](../../../.cortex/dynamic-skills/code-review-comments.md).

Read [`.cortex/AGENTS.md`](../../../.cortex/AGENTS.md) before starting. For every
active, non-outdated CodeRabbit thread, verify the finding, use the included
AI-agent prompt as context, make the minimal correct fix or document why no code
change is needed, validate locally, push any change, leave a concise GitHub reply
on the review thread, then resolve the conversation. Do not silently resolve
review conversations.
