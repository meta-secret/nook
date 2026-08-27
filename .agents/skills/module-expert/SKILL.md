---
name: module-expert
description: >-
  Route Nook module analysis through one registered read-only expert. Use when
  planning, reviewing, or implementing a change owned by a production Rust or
  web module.
---

# Module Expert

Read and follow:

- [the universal worker contract](../../../.cortex/AGENTS.md#team-worker-contract);
- [the canonical skill](../../../.cortex/teams/ai/dynamic-skills/module-expert.md);
- [the module expert registry](../../../.cortex/teams/ai/architecture/module-experts.md);
- [the module-oriented workflow](../../../.cortex/gizmo/workflows/module-oriented-development.md); and
- [subagent delegation](../../../.cortex/gizmo/workflows/subagent-delegation.md).

Resolve one stable semantic role before exploring its source.
Load only the task-selected authorities and skills allowed by that role's
Cortex contract.

Every module expert remains read-only. Write-capable module work belongs to a
separate implementation task.

The active harness owns native worker creation, labels or names, model
inheritance or selection, scheduling, communication, retries, cancellation,
and barriers.

This wrapper adds no native label, model rule, capability grant, write
ownership, successor scheduling, or lifecycle authority.

Optional Loom journals and Markdown views may support human inspection. They
must not gate expert dispatch, continuation, retry, join, or completion.
