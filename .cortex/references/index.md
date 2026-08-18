# References Index

## Overview

Reference documents provide durable technology cheat sheets, runtime configurations, protocol schemas, and debugging playbooks.

- **Consult during tasks:** Retrieve exact reference anchors from [`.cortex/knowledge-graph.md`](../knowledge-graph.md) when debugging, interacting with WASM bindings, checking log formats, or using Loom tools.
- **Maintain dynamically:** When tooling commands, logging schemas, WASM binding signatures, or platform operational capabilities change, agents must update the corresponding reference document in the same PR.
- **Consistency:** Treat stale commands or obsolete tool flags in `references/` as P1 documentation defects under [`../dynamic-skills/cortex-consistency.md`](../dynamic-skills/cortex-consistency.md).

## Reference catalog

- **[logging.md](logging.md)**
  - Description: Application logger architecture, IndexedDB persistence, `/app-logs`, and debugging protocols
  - Topics: `tracing`, `console.*`, `nook_logs`, Playwright logs
- **[rust-wasm.md](rust-wasm.md)**
  - Description: Rust + WASM bridge reference, wasm-bindgen rules, and typed boundary contracts
  - Topics: `wasm-bindgen`, build modes, WASM exports
- **[loom-tools.md](loom-tools.md)**
  - Description: Loom CLI tool runner, YAML protocol blueprints, and static agent workflow execution
  - Topics: Loom tools, static workflows, domain YAML
- **[ai-debugging.md](ai-debugging.md)**
  - Description: Comprehensive AI-agent debugging cheat sheet, browser profiles, and failure triage
  - Topics: Post-mortem debugging, test triage, log replay
- **[bun-svelte.md](bun-svelte.md)**
  - Description: Svelte 5 runes, Vite dev server, Bun tooling, and unused code enforcement
  - Topics: Svelte 5, Vite transforms, Knip, jscpd
- **[cloudflare-operations.md](cloudflare-operations.md)**
  - Description: Cloudflare MCP connection, Pages deployment, and control-plane operation rules
  - Topics: MCP `cloudflare-api`, DNS, Pages, deployment verification
