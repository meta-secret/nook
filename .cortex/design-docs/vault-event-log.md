# Vault Event Log

**Status:** Implemented (see [#112](https://github.com/meta-secret/nook/issues/112), PR #118+)  
**Supersedes:** scalar `vault_version` whole-blob sync in [unified-vault.md](unified-vault.md)  
**Migration coordination:** [#52](https://github.com/meta-secret/nook/issues/52) — safe legacy import via `vault-imported` genesis event (not YAML schema v2 cutover)

## Decision

Replace mutable `nook-vault.yaml` replication with an **immutable, content-addressed event log** synchronized by **set union** across providers. Rebuild the encrypted materialized vault with a **causal DAG** and a **deterministic Nook-specific reducer**.

Do **not** use:

- a scalar revision counter as the source of truth;
- wall-clock or hash last-writer-wins for secrets or security state;
- a generic CRDT library as the initial merge engine.

## Architecture

```text
local command
  → signed encrypted event (canonical JSON + Ed25519)
  → IndexedDB event store
  ↔ set union ↔ GitHub / Drive immutable event files
  → validate hash, signature, schema, parents
  → causal DAG
  → deterministic encrypted projection
  → plaintext WASM session (unlocked only)
```

### Source of truth

The immutable event set is authoritative. These are **derived caches only**:

- encrypted IndexedDB projection;
- optional immutable checkpoints;
- plaintext `Database` session;
- UI arrays.

`nook-vault.yaml` becomes a legacy import/export and recovery format.

## Event identity

| Property | Rule |
|----------|------|
| Event ID | SHA-256 of canonical body bytes (`sha256:{hex}`) |
| Remote path | `nook-log/v1/events/{shard}/{digest}.event` |
| Writes | append-only; `put_event_if_absent` |
| Duplicate identical event | success (idempotent) |
| Same path, different bytes | quarantine (corruption) |

## Canonical encoding

Events are hashed and signed over **canonical JSON**:

- object keys sorted lexicographically at every level;
- array order preserved (`parents` sorted before signing);
- `created_at` is audit/UI only — never used for merge correctness.

Implementation: `nook-core/src/event_canonical.rs`.

## Causal model

Each event lists all locally observed heads in `parents`. Therefore:

- **before:** ancestor in the DAG;
- **concurrent:** neither event is an ancestor of the other;
- **join:** a later event references both heads.

Unknown-parent events stay **pending** until dependencies arrive.

Implementation: `nook-core/src/vault_event_graph.rs`.

## Domain projection

The reducer (`nook-core/src/vault_projection.rs`) must yield the same result for every permutation of the same valid event set.

| Operation | Semantics |
|-----------|-----------|
| `secret-created` | Grow-only; idempotent duplicate |
| `secret-deleted` | Tombstone when delete is causal descendant of create |
| `secret-replaced` | Atomic tombstone + new record |
| Concurrent replacements | Both new records live; conflict group on old id |
| Independent concurrent adds | Both preserved |
| `device-revoked` / password rotate/remove | Starts new **key epoch** (Phase 2 crypto) |
| Concurrent security epochs | Security conflict — fail closed |

## Key epochs

Password rotation, password removal, and device revocation must rotate `secrets_key` / `members_key` so append-only history cannot resurrect access. Epoch identity is the rotation **event id**, not a global integer.

Phase 1 defines epoch metadata and conflict detection (`nook-core/src/vault_epoch.rs`). Wrapping and checkpoint re-encryption land in Phase 2.

## Provider interface (target)

```text
list_event_ids(provider, store_id, cursor?)
fetch_event(provider, store_id, event_id)
put_event_if_absent(provider, store_id, event_id, bytes)
```

No `update_event` or `delete_event` in v1.

## Migration

1. Deterministic `vault-imported` genesis event from stored vault bytes via `VaultHashContext` (`nook-core/src/vault_import.rs`).
2. Local append before remote upload.
3. Set-union fan-out to all providers.

See [#52](https://github.com/meta-secret/nook/issues/52) for schema migration coordination.

## Rollout phases

| Phase | Scope |
|-------|--------|
| 0 | This ADR |
| 1 | `nook-core` event model, DAG, projection, import |
| 2 | Ed25519 device keys, epoch crypto, actor authorization |
| 3 | IndexedDB event store, outbox, projection cache |
| 4 | GitHub / Drive event adapters |
| 5 | WASM manager + UI |
| 6 | User migration |
| 7 | Legacy write removal — **done** (event log is the only write path; YAML is projection cache only) |

## Testing requirements

Nook uses a **causal DAG** (parent head sets), not scalar vector clocks. Concurrency is `are_concurrent(a, b)` — neither event is an ancestor of the other. Sync is **set union** of immutable events.

These behaviors must be covered by **Rust tests** (~99% of sync correctness). E2e does not substitute.

| Scenario | Test location |
|----------|---------------|
| Concurrent append, both secrets live | `vault_event_graph.rs`, `vault_projection.rs`, `event_log_workflow.rs` |
| Out-of-order delivery → pending → applied | `vault_event_graph.rs`, `vault_event_store.rs`, `event_log_workflow.rs` |
| Join event collapses multiple heads | `vault_event_graph.rs`, `event_log_workflow.rs` |
| Replacement / security conflicts | `vault_projection.rs`, `vault_epoch.rs` |
| Multi-device decentralized union | `event_log_workflow.rs` (harness) |
| Projection replay invariance | `vault_projection.rs` (`assert_projection_permutation_invariant`) |
| Provider outbox + union | `event_log_workflow.rs`, `vault_event_store.rs` |

When adding operations or merge rules, add colocated unit tests **and** extend the harness scenarios if multi-device behavior changes.

**Coverage:** `task rust:coverage:check` enforces a **90%** line floor (`nook-core/coverage-floor.json`). Event-log modules (`vault_event_graph`, `vault_projection`, `vault_event_store`) are high-priority for test additions when changing sync semantics or when coverage drops below 90%.

## Related

- [#112](https://github.com/meta-secret/nook/issues/112) — full specification
- [#12](https://github.com/meta-secret/nook/issues/12) — multi-provider platform
- [#52](https://github.com/meta-secret/nook/issues/52) — schema versioning
- [unified-vault.md](unified-vault.md) — current whole-blob model (legacy)
