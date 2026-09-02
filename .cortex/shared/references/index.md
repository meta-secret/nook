# References Index

## Overview

Reference documents provide durable technology cheat sheets, runtime configurations, protocol schemas, and debugging playbooks.

- **Consult during tasks:** Retrieve exact reference anchors from [`.cortex/knowledge-graph.md`](../../knowledge-graph.md) when debugging, interacting with WASM bindings, checking log formats, or using Loom tools.
- **Maintain dynamically:** When tooling commands, logging schemas, WASM binding signatures, or platform operational capabilities change, agents must update the corresponding reference document in the same PR.
- **Consistency:** Treat stale commands or obsolete tool flags in `references/` as P1 documentation defects under [`../dynamic-skills/cortex-consistency.md`](../../teams/ai/dynamic-skills/cortex-consistency.md).

## Reference catalog

- **[logging.md](logging.md)**
  - Description: Application logger architecture, IndexedDB persistence, `/app-logs`, and debugging protocols
  - Topics: `tracing`, `console.*`, `nook_logs`, Playwright logs
- **[rust-wasm.md](../../teams/dev-core/references/rust-wasm.md)**
  - Description: Rust + WASM bridge reference, wasm-bindgen rules, and typed boundary contracts
  - Topics: `wasm-bindgen`, build modes, WASM exports
- **[loom-tools.md](../../teams/ai/references/loom-tools.md)**
  - Description: Loom CLI tool runner, YAML requests, and deterministic audits
  - Topics: Loom tools, typed requests, domain YAML
- **[ai-debugging.md](../../teams/web-dev/references/ai-debugging.md)**
  - Description: Comprehensive AI-agent debugging cheat sheet, browser profiles, and failure triage
  - Topics: Post-mortem debugging, test triage, log replay
- **[bun-svelte.md](../../teams/web-dev/references/bun-svelte.md)**
  - Description: Svelte 5 runes, Vite dev server, Bun tooling, and unused code enforcement
  - Topics: Svelte 5, Vite transforms, Knip, jscpd
- **[cloudflare-operations.md](../../teams/sre/references/cloudflare-operations.md)**
  - Description: Cloudflare MCP connection, Pages deployment, and control-plane operation rules
  - Topics: MCP `cloudflare-api`, DNS, Pages, deployment verification
- **[infrastructure-provider-operations.md](../../teams/sre/references/infrastructure-provider-operations.md)**
  - Description: Provider interface priority, automatic local credential persistence, and mutation verification
  - Topics: MCP, API, CLI, `~/.nook`, credential permissions, exact-target checks
