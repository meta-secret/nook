---
name: product-spec-lifecycle
description: >-
  Enforce Nook's critical .cortex product specification lifecycle rule: read
  owning product specs before planning or implementing product features, and
  update specs whenever important product knowledge is gained from chat, tasks,
  or PR iterations.
---

# Product Specification Lifecycle

Read and follow the canonical project rule at
[`.cortex/dynamic-skills/product-spec-lifecycle.md`](../../../.cortex/dynamic-skills/product-spec-lifecycle.md).

Product specifications in `.cortex/product-specs/` are the living system of record for user-facing requirements.

## Required response

1. Find and read the owning `.cortex/product-specs/` document before modifying product behavior.
2. Incorporate specification requirements into the task plan.
3. Update existing specs or author new ones when chat or execution reveals product rules or flows.
4. Keep `.cortex/product-specs/index.md` and `.cortex/knowledge-graph.md` synchronized.
5. Fix obsolete or conflicting specification claims in the same PR.
6. Keep new prose under [cortex-writer](../cortex-writer/SKILL.md).
