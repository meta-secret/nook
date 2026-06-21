# Nook

Rust + WebAssembly + Svelte monorepo. One-way dependency flow: `nook-core → nook-wasm → nook-web`.

## Docs

- [architecture.md](architecture.md) — project shape, packages, commands, quality gates.
- [rules.md](rules.md) — hard constraints that apply to every change.

## Workflows

- [workflows/monorepo.md](workflows/monorepo.md) — cross-package feature work.
- [workflows/quality.md](workflows/quality.md) — checks, CI, and deployment.

## Quick Reference

- **Commands**: `Taskfile.yml` is the command surface. Run `task check` to verify.
- **Build image**: Docker Buildx Bake via `docker-bake.hcl`.
- **JS runtime**: Bun only. No npm.
- **UI**: shadcn-svelte defaults in `nook-web/src/lib/components/ui`.

When architecture, commands, or quality gates change — update these docs in the same PR.
