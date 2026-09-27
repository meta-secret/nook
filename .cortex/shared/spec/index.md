# Shared Specifications

## Overview

This catalog links application specifications and repository-wide tooling and
operational specifications. Application-owned content lives in `nook-app/.cortex/docs/spec/`.

- **Consult during tasks:** Retrieve exact specification anchors from [`.cortex/knowledge-graph.md`](../../knowledge-graph.md) when debugging, interacting with WASM bindings, checking log formats, or using Loom tools.
- **Maintain dynamically:** When tooling commands, logging schemas, WASM binding signatures, or platform operational capabilities change, agents must update the corresponding specification in the same PR.
- **Consistency:** Treat stale commands or obsolete tool flags in specifications as P1 documentation defects under [`cortex-consistency/SKILL.md`](../../teams/ai/dynamic-skills/cortex-consistency/SKILL.md).

## Specification catalog

- **[Nook application specifications](../../../nook-app/.cortex/docs/spec/index.md)**
  - Description: Application logging, Rust/WASM contracts, and browser tooling
  - Topics: Persisted logs, typed bindings, Svelte, Vite, Bun
- **[loom-tools.md](../../teams/ai/references/loom-tools.md)**
  - Description: Loom CLI tool runner, YAML requests, and deterministic audits
  - Topics: Loom tools, typed requests, domain YAML
- **[cloudflare-operations.md](../../teams/sre/references/cloudflare-operations.md)**
  - Description: Cloudflare MCP connection, Pages deployment, and control-plane operation rules
  - Topics: MCP `cloudflare-api`, DNS, Pages, deployment verification
- **[infrastructure-provider-operations.md](../../teams/sre/references/infrastructure-provider-operations.md)**
  - Description: Provider interface priority, automatic local credential persistence, and mutation verification
  - Topics: MCP, API, CLI, `~/.nook`, credential permissions, exact-target checks
