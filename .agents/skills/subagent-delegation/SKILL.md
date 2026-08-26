---
name: subagent-delegation
description: >-
  Apply Nook's hierarchical subagent protocol whenever work is delegated or a
  compiled agent workflow is created, changed, reviewed, or executed. Require
  immutable per-attempt action streams, explicit parent lineage, agent-authored
  Markdown semantic views, all-terminal aggregation where failures carry
  evidence, recursive parent materialization, and delivery-owner control.
---

# Subagent Delegation

Read and follow the canonical workflow at
[`.cortex/workflows/subagent-delegation.md`](../../../.cortex/workflows/subagent-delegation.md).

Before dispatch:

1. Declare the exact baseline, task identity, attempt, parent lineage, resource
   scope, terminal barrier, and parent-owned join.
2. Keep one delivery owner for shared files and lifecycle state.
3. Use Loom or another deterministic tool for mechanical work.
4. For ordinary coding delegation, require the child to return one `record`
   request containing its bounded observable actions and typed semantic result.
   The parent finalizes it with
   `task loom:agent-delegation:record REQUEST=<request.json>`. Static Loom
   workflows record the same contract automatically.
5. Keep hierarchy depth at three or less.
   - Normal work uses synthesis at depth 1 and experts at depth 2.
   - Depth 3 must be exceptional and predeclared by the reviewed parent.
   - A child must not freely delegate or create another tier.

For every reached agent attempt:

1. Persist bounded observable actions in its append-only JSONL stream.
2. Exclude prompts, reasoning, secrets, raw command output, and raw errors.
3. Require an agent-authored Markdown semantic view in the typed result.
4. Let Loom validate, persist, hash, and reference the result and view.
5. Use a clearly labeled Loom-authored failure view when no agent view exists.

Before continuation or completion:

1. Wait for the declared terminal barrier.
2. Verify lineage, continuity, projection paths, and hashes.
3. Give the parent child views and typed artifacts by default.
4. Require the parent to author the next aggregate view.
5. Repeat through the root aggregate.
6. Let the delivery owner validate that root view and author the final report.
7. For ordinary delegation, submit the exact ordered child terminal/result/view
   hash manifest and finalize with
   `task loom:agent-delegation:finalize REQUEST=<request.json>`.

Never allow a child stream to become an independent scheduling authority.
Never parse Markdown to decide workflow transitions.

For module-oriented work, also load
[`module-oriented-development.md`](../../../.cortex/workflows/module-oriented-development.md)
and the named
[`module expert registry`](../../../.cortex/architecture/module-experts.md).
