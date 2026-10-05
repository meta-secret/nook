# Product Specification Lifecycle

## Overview

Product specifications are the living system of record for user-facing and system-level requirements.

- AI agents must read the owning specification before implementing or modifying product features.
- AI agents must update specifications in the same PR when chat conversations, task execution, or PR reviews reveal new product knowledge.
- If a new user-facing feature or item type is introduced, create a new specification file and register it in the owning catalog routed from the [shared specification index](index.md).
- Full lifecycle contract: [`dynamic-skills/product-spec-lifecycle.md`](../../../teams/ai/dynamic-skills/product-spec-lifecycle.md).

## Maintenance

- **Consult during tasks:** Retrieve exact specification anchors from [`.cortex/index.md`](../../../index.md) when debugging, interacting with WASM bindings, checking log formats, or using Loom tools.
- **Maintain dynamically:** When tooling commands, logging schemas, WASM binding signatures, or platform operational capabilities change, agents must update the corresponding specification in the same PR.
- **Consistency:** Treat stale commands or obsolete tool flags in specifications as P1 documentation defects under [Cortex consistency](../../../teams/ai/dynamic-skills/cortex-consistency/SKILL.md).
