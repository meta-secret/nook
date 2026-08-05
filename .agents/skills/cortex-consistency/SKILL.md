---
name: cortex-consistency
description: >-
  Enforce Nook's critical .cortex consistency garbage-collector rule: verify
  docs are not obsolete, do not conflict with each other, and do not conflict
  with the code. Use when editing .cortex, changing durable architecture or
  workflows, capturing dynamic skills, or auditing cortex freshness.
---

# Cortex Consistency

Read and follow the canonical project rule at
[`.cortex/dynamic-skills/cortex-consistency.md`](../../../.cortex/dynamic-skills/cortex-consistency.md).

Every durable `.cortex` claim must stay consistent with sibling docs and code.

## Required response

1. Find the owning `.cortex` docs for the touched topic.
2. Check those docs against each other.
3. Check those docs against current code and Task entrypoints.
4. Fix obsolete or conflicting guidance in the same PR.
5. Label historical context instead of leaving it as current policy.
6. Keep new prose under [cortex-writer](../cortex-writer/SKILL.md).
