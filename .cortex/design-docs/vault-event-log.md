# Vault Event Log

**Status:** Implemented (see [#112](https://github.com/meta-secret/nook/issues/112), PR #118+, PR #181)
**Supersedes:** scalar `vault_version` whole-blob sync in [unified-vault.md](unified-vault.md)  
**Migration coordination:** [#52](https://github.com/meta-secret/nook/issues/52) — safe projection import via `vault-imported` genesis event (not YAML schema v2 cutover)

## Decision

Replace mutable projection replication with an **immutable, content-addressed event log** synchronized by **set union** across providers. Rebuild the encrypted materialized vault with a **causal DAG** and a **deterministic Nook-specific reducer**.

Do **not** use:

- a scalar revision counter as the source of truth;
- wall-clock or hash last-writer-wins for secrets or security state;
- a generic CRDT library as the initial merge engine.

## Architecture

```text
local command
  → signed encrypted event (canonical JSON + Ed25519)
  → IndexedDB event store
  ↔ set union ↔ GitHub / Drive / iCloud immutable event records
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

Projection YAML is a browser-local import/export format, not a provider sync
artifact for event-log vaults.

## Event identity

| Property | Rule |
|----------|------|
| Event ID | SHA-256 of canonical body bytes (`sha256u:{base64url_no_pad}`) |
| Remote path | `nook-log/v1/events/{digest}.yaml` |
| Writes | append-only; `put_event_if_absent` |
| Duplicate identical event | success (idempotent) |
| Same path, different bytes | quarantine (corruption) |

Current event schema `2` binds each event to `actor_signing_public_key`. The
actor id must be the SHA-256 digest of that Ed25519 public key, and the event
signature must verify over the canonical body before a current-schema remote
event enters the local event set. Non-genesis events are also checked against
the event's causal past: an actor is accepted only if it is the import root, was
introduced by a causally prior `join-approved` / `nexus-participant-enrolled`,
or is publishing its own self-signed membership event under a narrow policy:

- `join-requested` — always allowed when self-signed (pending join);
- `join-approved` — self-signed only for simple password QR self-enrol, and only
  when causal ancestry has no nexus membership/share ops
  (`nexus-participant-enrolled` / `nexus-shares-issued`);
- `nexus-participant-enrolled` — never self-signed; must be signed by an
  already-authorized actor (owner approval / genesis).

### Nexus genesis correction

The target Nexus lifecycle does not build a vault roster incrementally through
pre-genesis events. Participant public keys are collected in a separate typed
genesis session before a `store_id`, vault event set, or authorized actor graph
exists. Atomic Nexus genesis creates the initial authorized roster, policy, and
complete encrypted share commitments together. The current
`nexus-participant-enrolled` / `nexus-shares-issued` sequence is implementation
debt and must not be treated as the target protocol. See
[nexus-genesis.md](nexus-genesis.md).

## Canonical encoding

Events are hashed and signed over **canonical JSON**:

- object keys sorted lexicographically at every level;
- array order preserved (`parents` sorted before signing);
- `created_at` is audit/UI only — never used for merge correctness.

Implementation: `nook-app/nook-core/src/event_canonical.rs`.

## Causal model

Each event lists all locally observed heads in `parents`. Therefore:

- **before:** ancestor in the DAG;
- **concurrent:** neither event is an ancestor of the other;
- **join:** a later event references both heads.

Unknown-parent events stay **pending** until dependencies arrive.

Implementation: `nook-app/nook-core/src/vault_event_graph.rs`.

## Domain projection

The reducer (`nook-app/nook-core/src/vault_projection.rs`) must yield the same result for every permutation of the same valid event set.

| Operation | Semantics |
|-----------|-----------|
| `secret-created` | Grow-only; idempotent duplicate |
| `secret-deleted` | Tombstone when delete is causal descendant of create |
| `secret-replaced` | Atomic tombstone + new record |
| Concurrent replacements | Both new records live; conflict group on old id |
| `secret-conflict-resolved` | Tombstones rejected candidates and causally clears the conflict |
| Independent concurrent adds | Both preserved |
| `device-revoked` / password rotate/remove | Starts new **key epoch** with fresh vault keys and checkpoint |
| Concurrent security epochs | Security conflict — fail closed; local edits are blocked until all devices sync/recover |

## Key epochs

Password rotation, password removal, and device revocation rotate
`secrets_key` / `members_key` so append-only history cannot resurrect access.
Epoch identity is the rotation **event id**, not a global integer.

The implemented epoch path creates fresh vault keys, re-encrypts live secrets,
rewraps auth/member metadata for remaining authorized entries, and appends an
immutable `epoch-checkpoint`. Concurrent security rotations are detected in the
projection, surfaced through WASM/UI, and fail closed for further local edits.

## Provider interface (target)

```text
list_event_ids(provider, store_id, cursor?)
fetch_event(provider, store_id, event_id)
put_event_if_absent(provider, store_id, event_id, bytes)
```

No `update_event` or `delete_event` in v1.

The active provider adapters are GitHub, Google Drive, and iCloud. During
outbox flush, the manager first uploads queued events that are absent remotely,
then repairs the provider by uploading any local event-store events missing from
that provider. During pull, fetched remote events are hash/signature-validated
and ignored when their signed body belongs to another `store_id`.

Provider connect and sync paths must classify the provider event set before
writing outbox or repair events. Empty providers may be initialized from the
active local vault, and a provider with exactly the active `store_id` may be
union-synced. A provider with a different `store_id`, multiple discovered
`store_id`s, unreadable event files, or invalid event bytes must fail closed
before any write; the user must choose an explicit recovery/import path instead
of letting the current local vault silently take over provider data.

Event-log provider sync never writes the materialized projection. Normal
provider fan-out appends YAML event files and repairs missing provider events
from the local event store.

Drive event storage tolerates duplicate app-data files for the same event name:
fetch downloads all matches, accepts only bytes whose content-derived event id
matches the requested id, treats identical duplicates as one event, and reports
different bytes as corruption.

## IndexedDB storage

`nook_db` version `2` separates event-log state into dedicated object stores:

| Store | Purpose |
|-------|---------|
| `events` | Immutable event bytes and event indexes |
| `outbox` | Durable per-provider retry queue |
| `projections` | Projection heads, key-epoch markers, and source projection backup bytes |
| `provider_receipts` | Reserved for compact per-provider sync receipts |
| `vault` | Source projection cache plus local device/signing identity material |

Event-log reads and writes use the separated stores. Event heads, key epochs,
event bytes, outbox rows, and source projection backups must not be read from
any other `IndexedDB` object store.

## Migration

1. Byte-for-byte backup of source projection YAML → `source_backup:{store_id}` in IndexedDB (first import only).
2. `verify_stored_vault_import` — secret id parity before append.
3. Deterministic `vault-imported` genesis event from `VaultHashContext` (`nook-app/nook-core/src/vault_import.rs`).
4. Local append before remote upload (`MIGRATION_START` / `MIGRATION_SUCCESS` status events).
5. Set-union fan-out to all providers; later provider flushes repair any local
   events the provider does not yet have.

See [vault-schema-versioning.md](vault-schema-versioning.md) for #52 goal mapping.

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
| 7 | Provider projection removal — **done** (event log is the only provider write path; YAML is local/import material only) |

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

**Coverage:** `task rust:coverage:check` enforces a **90%** line floor (`nook-app/nook-core/coverage-floor.json`). Event-log modules (`vault_event_graph`, `vault_projection`, `vault_event_store`) are high-priority for test additions when changing sync semantics or when coverage drops below 90%.

## Related

- [#112](https://github.com/meta-secret/nook/issues/112) — full specification
- [#12](https://github.com/meta-secret/nook/issues/12) — multi-provider platform
- [#52](https://github.com/meta-secret/nook/issues/52) — schema versioning
- [unified-vault.md](unified-vault.md) — superseded whole-blob model
