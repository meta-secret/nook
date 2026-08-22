---
name: module-expert
description: >-
  Route Nook module analysis through one registered read-only expert. Use when
  planning, reviewing, or implementing a change owned by a production Rust or
  web module.
---

# Module Expert

Read and follow:

- [the canonical skill](../../../.cortex/dynamic-skills/module-expert.md);
- [the module expert registry](../../../.cortex/architecture/module-experts.md);
- [the module-oriented workflow](../../../.cortex/workflows/module-oriented-development.md).

Resolve one named profile before exploring its source.
Load only that profile's authorities and task-relevant skills.

Treat every profile as read-only.
Do not delegate, schedule successors, mutate lifecycle state, or infer write
permission from catalog paths.
