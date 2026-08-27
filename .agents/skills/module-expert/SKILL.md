---
name: module-expert
description: >-
  Route Nook module analysis through one registered read-only expert. Use when
  planning, reviewing, or implementing a change owned by a production Rust or
  web module.
---

# Module Expert

Read and follow:

- [the canonical skill](../../../.cortex/teams/ai/dynamic-skills/module-expert.md);
- [the module expert registry](../../../.cortex/teams/ai/architecture/module-experts.md);
- [the module-oriented workflow](../../../.cortex/teams/ai/workflows/module-oriented-development.md).

Resolve one named profile before exploring its source.
Load only that profile's authorities and task-relevant skills.

Every module expert profile remains read-only. When the delivery plan assigns
write-capable module work, a separate implementation worker receives the
isolated workspace and explicit path scope.

Use the active Codex, Cursor, or other capable harness to create and coordinate
the expert. The harness owns communication, scheduling, retries, cancellation,
nested delegation, and synthesis.

The profile routes domain knowledge. It does not grant filesystem capability,
write ownership, successor scheduling, or lifecycle authority.

Optional Loom journals and Markdown views may support human inspection. They
must not gate expert dispatch, continuation, retry, join, or completion.
