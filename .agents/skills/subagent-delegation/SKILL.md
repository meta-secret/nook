---
name: subagent-delegation
description: >-
  Apply Nook's hierarchical subagent protocol whenever work is delegated or a
  compiled agent workflow is created, changed, reviewed, or executed. Use the
  active harness for coordination. Require bounded task contracts, isolated
  write workspaces, commit handoffs, acceptance evidence, and one delivery
  owner.
---

# Subagent Delegation

Read and follow the canonical workflow at
[`.cortex/teams/ai/workflows/subagent-delegation.md`](../../../.cortex/teams/ai/workflows/subagent-delegation.md).

Before dispatch:

1. Declare the exact baseline, task identity, parent lineage, dependencies,
   resource scope, acceptance evidence, and parent-owned join.
2. Keep one delivery owner for shared files and lifecycle state.
3. Let the active Codex, Cursor, or other capable harness own subagent creation,
   communication, scheduling, retries, cancellation, barriers, nested
   delegation, and synthesis.
4. Use Loom or another deterministic tool for mechanical work.
5. Declare a task-specific hierarchy depth bound before dispatch.
6. Give every write-capable worker a separate disposable worktree or workspace.
7. Require a verified commit handoff from each successful writer.

During execution:

1. Enforce dependency readiness and non-overlapping resource claims.
2. Keep retries isolated from failed or cancelled workspace state.
3. Prevent children from widening their write scope.
4. Preserve the exact baseline used for every attempt.

Before continuation or completion:

1. Let the harness wait for the declared dependency or terminal barrier.
2. Verify the commit against its baseline and allowed write scope.
3. Verify the declared acceptance evidence.
4. Integrate accepted commits in deterministic dependency order.
5. Bind downstream work to the exact integrated commit.
6. Let Gizmo validate the integrated result and author the report.

JSONL streams, result files, and Markdown summaries may be retained for human
inspection or audit evidence. They are never prerequisites for harness
dispatch, continuation, retry, join, or completion.

For module-oriented work, also load
[`module-oriented-development.md`](../../../.cortex/teams/ai/workflows/module-oriented-development.md)
and the named
[`module expert registry`](../../../.cortex/teams/ai/architecture/module-experts.md).

For implementation work, also load
[`team-oriented-development.md`](../../../.cortex/teams/ai/workflows/team-oriented-development.md)
and keep each child inside one engineering-team boundary.
