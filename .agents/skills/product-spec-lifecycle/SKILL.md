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

Team-owned product specifications are the living system of record for
user-facing requirements.

## Required response

1. Select the responsible team and read the owning specification through its
   knowledge graph before modifying product behavior.
2. Incorporate specification requirements into the task plan.
3. Update existing specs or author new ones when chat or execution reveals product rules or flows.
4. Keep `.cortex/product-specs/index.md` and the owning team knowledge graph synchronized.
5. Fix obsolete or conflicting specification claims in the same PR.
6. Keep new prose under [cortex-writer](../cortex-writer/SKILL.md).
7. Promote durable behavior discovered in strong Rust, WASM, or Playwright
   scenarios into the owning product specification.
