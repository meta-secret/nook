---
name: code-review-comments
description: >-
  Use when addressing human, Codex, or automated PR review comments in Nook.
  Inspect submitted reviews, inline review threads, and PR comments; build a
  checklist from actionable items; route verification and fixes to the
  responsible team; then integrate, validate, push, reply, and resolve through
  Gizmo. This skill does not initiate reviews. The exact-head Codex request
  belongs to PR delivery.
---

# Code Review Comments

System of record:
[`.cortex/gizmo/dynamic-skills/code-review-comments.md`](../../../.cortex/gizmo/dynamic-skills/code-review-comments.md).

Read [`.cortex/AGENTS.md`](../../../.cortex/AGENTS.md) before starting. Gizmo
inspects submitted reviews, inline review threads, and PR comments. It filters
findings against the exact current head and dispatches each active actionable
item to the responsible team agent.

The team agent verifies the finding, implements the minimal correct fix when
required, and returns focused proof. Gizmo coordinates no-change findings,
integrates team handoffs, runs `task format`, completes validation, pushes
changes, and leaves a targeted reply on the original review target. Gizmo
resolves a conversation only after the reply is visible. It tracks unthreaded
review-body findings in the delivery checklist and final handoff.

Proceed only when complete repository-owned validation is green and zero
unresolved actionable threads remain.
These are normally `PR / Verify and preview`, plus `Web research / Build and
deploy research catalog` when web-research paths change. Do not wait for a
review result after checks finish or request another external review service.

Use the concrete, paginated review-thread GraphQL query and the current-head
`commit_id` comparison in the system-of-record skill; do not infer current
findings from unfiltered flat review lists.
