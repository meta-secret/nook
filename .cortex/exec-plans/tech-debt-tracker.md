# Technical Debt Tracker

We track known technical debt, version updates, and cleanup tasks to resolve them incrementally.

| Debt Item | Package | Context | Status |
|---|---|---|---|
| Replace raw `String`/`u32` with domain newtypes | nook-core / nook-wasm | Event envelope, projection, wire types — see [typed-newtypes.md](../design-docs/typed-newtypes.md). Current checklist: `nook-core/src/vault_connect.rs` and `nook-core/src/vault_sync_session.rs` normalized loaded vault metadata/key fields; `nook-wasm/src/storage/indexed_db.rs` normalized local vault registry labels/timestamps; `nook-wasm/src/logger.rs` normalized log timestamps; `nook-wasm/src/manager/event_log.rs` normalizes external event YAML into typed `VaultEvent`. Remaining audit targets: provider snapshot compatibility structs in `nook-core/src/sync_provider_store.rs`, API DTO option bags in `nook-wasm/src/types.rs`, manager session sentinel strings in `nook-wasm/src/manager/mod.rs`, member/enrollment timestamp strings in `nook-core/src/multi_device.rs` and `nook-core/src/enrollment.rs`, and projection conflict optional fields in `nook-core/src/vault_projection.rs`. | In progress |
| Upgrade Svelte & ESLint dependencies to latest | nook-web | Upgraded Lucide-Svelte, ESLint, globals, Prettier plugin. Added explicit `@eslint/js` dependency to resolve CI resolution issues. | Resolved |
| Relocate Dockerfile & Optimize Caching | repo | Relocated `.docker/build.Dockerfile` to `Dockerfile` at root and restructured layers. | Resolved |
| Fix `table.grow` WebAssembly error | nook-wasm | Upgraded `wasm-pack` and manually installed `binaryen` version 122. | Resolved |
