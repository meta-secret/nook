---
name: internal-api-expert
description: >-
  Design and review Nook consumer contracts across Rust crates, both WASM
  bridges, generated bindings, and TypeScript adapters. Use when a changed
  feature crosses a registered module boundary.
---

# Internal API Expert

Read and follow:

- [the canonical skill](../../../.cortex/dynamic-skills/internal-api-expert.md);
- [the internal API registry entry](../../../.cortex/architecture/module-experts.md#internal-api-expert);
- [the module-oriented workflow](../../../.cortex/workflows/module-oriented-development.md).

Return a bounded provider-consumer contract brief.
Do not implement, delegate, schedule work, or mutate lifecycle state while
acting as this read-only expert.

There is no separate WASM or bridge expert.
