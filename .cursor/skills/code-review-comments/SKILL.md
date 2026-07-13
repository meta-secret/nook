---
name: code-review-comments
description: >-
  Use when addressing human, Codex, or automated PR review comments in Nook.
  Inspect submitted reviews, inline review threads, and PR comments; build a
  checklist from actionable items; verify each finding; fix or explain it;
  validate, push, reply on GitHub, and resolve conversations only after the
  agent's targeted reply is visible. Use only for comments already present;
  never request, poll, or wait for an external review or check.
---

# Code Review Comments

System of record: [`.cortex/dynamic-skills/code-review-comments.md`](../../../.cortex/dynamic-skills/code-review-comments.md).

Read [`.cortex/AGENTS.md`](../../../.cortex/AGENTS.md) before starting. Inspect
submitted reviews, inline review threads, and PR comments from humans, Codex,
and other automated reviewers. For every active, non-outdated actionable item,
verify the finding, use reviewer-provided agent prompts as context, make the
minimal correct fix or document why no code change is needed, validate locally,
push any change, and leave a concise targeted GitHub reply on the original
review thread or comment when GitHub supports one. Resolve a conversation only
after the reply is visible and resolution is the correct next action. Track
actionable submitted-review items without threaded reply targets in the local
checklist and final handoff rather than creating broad or duplicative PR
comments. Re-query reviews and unresolved threads before handoff.

Inspect the feedback currently present once, address every actionable item, and
then proceed as soon as Nook's applicable repository-owned PR test checks pass.
These are normally `PR / Verify and preview`, plus `Web research / Build and
deploy research catalog` when web-research paths change. Never wait for Codex or another service to comment, reply, re-review,
resolve, or finish a check, and never add a grace period for future feedback.

Use the concrete, paginated review-thread GraphQL query and the current-head
`commit_id` comparison in the system-of-record skill; do not infer current
findings from unfiltered flat review lists.
