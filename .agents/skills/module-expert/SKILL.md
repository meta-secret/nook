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
Run it only through Loom's isolated non-delegating SDK runtime.
Before invocation, require a completed, replay-verified depth-one
`ModuleDevelopmentPlan` whose typed `moduleExpertAuthorizations` entry exactly
matches the child task, expert, attempt, depth, and immediate parent.
For depth three, also require the completed immediate parent named by that
predeclaration.
Never treat `ModuleExpertEvidence`, Markdown, or `parentActions` as child
authorization.
Do not use ordinary native child spawning as the capability boundary.
Do not delegate, schedule successors, mutate lifecycle state, or infer write
permission from catalog paths.
