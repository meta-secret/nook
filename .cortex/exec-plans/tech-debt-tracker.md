# Technical Debt Tracker

We track known technical debt, version updates, and cleanup tasks to resolve them incrementally.

| Debt Item | Package | Context | Status |
|---|---|---|---|
| Replace raw `String`/`u32` with domain newtypes | nook-event-log / nook-core / nook-wasm | Event envelope, projection, wire types — see [typed-newtypes.md](../design-docs/typed-newtypes.md). | In progress |
| Upgrade Svelte & ESLint dependencies to latest | nook-web | Upgraded Lucide-Svelte, ESLint, globals, Prettier plugin. Added explicit `@eslint/js` dependency to resolve CI resolution issues. | Resolved |
| Relocate Dockerfile & Optimize Caching | repo | Relocated `.docker/build.Dockerfile` to `Dockerfile` at root and restructured layers. | Resolved |
| Fix `table.grow` WebAssembly error | nook-wasm | Upgraded `wasm-pack` and pinned the Binaryen toolchain. The current image uses Binaryen 131. | Resolved |

## Replace raw `String`/`u32` with domain newtypes

Scope: event envelope, projection, and wire types. See [typed-newtypes.md](../design-docs/typed-newtypes.md).

**Already normalized:**

- `nook-app/nook-platform/nook-core/src/vault/vault_connect.rs` — loaded vault metadata/key fields
- `nook-app/nook-platform/nook-core/src/sync/vault_sync_session.rs` — loaded vault metadata/key fields
- Vault access states now cross WASM as the core `VaultAccessStatus` enum
- `nook-app/nook-platform/nook-wasm/src/storage/indexed_db.rs` — local vault registry labels/timestamps
- `nook-app/nook-platform/nook-wasm/src/logger.rs` — log timestamps
- `nook-app/nook-platform/nook-wasm/src/manager/event_log.rs` — external event YAML into typed `VaultEvent`

**Remaining audit targets:**

- Provider snapshot compatibility structs in `nook-app/nook-platform/nook-core/src/sync/sync_provider_store.rs`
- API DTO option bags and other manager sentinel strings in `nook-app/nook-platform/nook-wasm/src/types.rs` / `manager/mod.rs`
- Member/enrollment timestamp strings in `nook-app/nook-platform/nook-core/src/auth/multi_device.rs` and `nook-app/nook-platform/nook-core/src/auth/enrollment.rs`
- Projection conflict optional fields in `nook-app/nook-platform/nook-event-log/src/projection.rs`
