# Vault Event Log

## Relationships

- [Identity, App Keys, Passkeys, and Vault DEKs](identity-vault-architecture.md)
  - Separates identity, app-key, vault-key, onboarding, and grant responsibilities.
  - Read before changing the related architecture or security boundary.
- [Sentinel Genesis and Reverse Onboarding](sentinel-genesis.md)
  - Defines Sentinel genesis material and recovery-related trust boundaries.
  - Read before changing the related architecture or security boundary.
- [Unified Vault Architecture](unified-vault.md)
  - Defines the local canonical vault and provider replication model.
  - Read before changing the related architecture or security boundary.

## Document map

- [Overview](#overview)
  - Records the implemented event-log decision and the projection-sync model it supersedes.
  - Read before changing vault persistence, replication, or migration.
- [Decision](#decision)
  - Makes immutable content-addressed events the replicated source of truth.
  - Read when evaluating alternative sync or storage designs.
  - [Identity-owned DEKs](#identity-owned-deks)
    - Assigns DEK creation and authorization to identities outside the event log.
    - Read when changing membership, grants, or key ownership.
- [Architecture](#architecture)
  - Separates domain events, replication mechanics, and provider adapters.
  - Read when deciding which package owns event-log behavior.
  - [Source of truth](#source-of-truth)
    - Distinguishes authoritative events from derived local projections.
    - Read when rebuilding, importing, or persisting projected state.
- [Event identity](#event-identity)
  - Defines event IDs, remote paths, parent references, signatures, and authorization.
  - Read before changing the event envelope or validation rules.
  - [Sentinel genesis correction](#sentinel-genesis-correction)
    - Keeps Sentinel pre-genesis ceremony outside incremental roster events.
    - Read when changing Sentinel genesis or participant authorization.
- [Canonical encoding](#canonical-encoding)
  - Defines deterministic bytes used for event hashing and signatures.
  - Read before changing serialization, signing, or cross-runtime fixtures.
- [Causal model](#causal-model)
  - Uses parent head sets to represent causality and deterministic ordering.
  - Read when changing merge, conflict, or ancestry behavior.
- [Domain projection](#domain-projection)
  - Requires deterministic projection and conflict resolution for any valid event order.
  - Read when adding events or changing reducer semantics.
- [Key epochs](#key-epochs)
  - Rotates `secrets_key` and `members_key` to prevent historical access resurrection.
  - Read when changing passwords, revocation, or encrypted event fields.
- [Provider interface (target)](#provider-interface-target)
  - Defines the target set-union operations required from storage providers.
  - Read when implementing or extending a provider adapter.
- [IndexedDB storage](#indexeddb-storage)
  - Defines the local IndexedDB stores for events, heads, projections, and replica state.
  - Read before changing browser persistence or database migration.
- [Rollout phases](#rollout-phases)
  - Tracks delivery from the ADR through event storage, provider sync, and UI adoption.
  - Read when assessing implementation status or sequencing remaining migration work.
- [Testing requirements](#testing-requirements)
  - Requires permutation, convergence, authorization, epoch, and provider-contract coverage.
  - Read when adding or reviewing event-log tests.
- [Related](#related)
  - Routes to the original specification and linked implementation context.
  - Read when historical rationale or delivery details are needed.

## Overview

**Status:** Implemented (see [#112](https://github.com/meta-secret/nook/issues/112), PR #118+, PR #181)
**Supersedes:** scalar `vault_version` whole-blob sync in [unified-vault.md](unified-vault.md)  
**Migration coordination:** [#52](https://github.com/meta-secret/nook/issues/52) — safe projection import via `vault-imported` genesis event (not YAML schema v2 cutover)

## Decision

Replace mutable projection replication with an **immutable, content-addressed event log** synchronized by **set union** across providers. Rebuild the encrypted materialized vault with a **causal DAG** and a **deterministic Nook-specific reducer**.

Do **not** use:

- a scalar revision counter as the source of truth;
- wall-clock or hash last-writer-wins for secrets or security state;
- a generic CRDT library as the initial merge engine.

### Identity-owned DEKs

The vault event log encrypts secrets under a DEK.
That DEK is generated and held by an **identity**.
The vault cannot exist without an authorizing identity.
Member and app-key roster changes update identity DEK envelopes.
They do not rewrite vault membership as the authority model.

Legacy `join-approved` and `auth:` envelopes remain a compatibility boundary.
See [identity-vault-architecture.md](identity-vault-architecture.md).

## Architecture

```text
local command
  → signed encrypted event (canonical JSON + Ed25519)
  → IndexedDB event store
  ↔ set union ↔ GitHub / Drive / iCloud immutable event records
  → validate hash, signature, schema, parents
  → causal DAG
  → deterministic encrypted projection
  → encrypted WASM session + page-scoped plaintext (unlocked only)
```

### Source of truth

The immutable event set is authoritative. These are **derived caches only**:

- encrypted IndexedDB projection;
- optional immutable checkpoints;
- ciphertext-backed unlocked WASM session;
- page-scoped plaintext UI arrays.

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

Current event schema `3` binds each event to `actor_signing_public_key`. The
actor id must be the SHA-256 digest of that Ed25519 public key. The event
signature must verify over the canonical body before a current-schema remote
event enters the local event set.

Checkpoint and visibility rules:

- An `epoch-checkpoint` persists `secrets`, `members_checkpoint_hash`, and the
  complete rewrapped `rotated_meta_records` and `password_entries` sets.
- A schema `3` checkpoint is the event's sole operation. It has exactly one
  direct parent, that parent is a single security trigger, and its `key_epoch`
  equals the trigger event id. Invalid standalone or bundled checkpoints are
  quarantined.
- Projection replaces the prior sets. Explicit empty arrays clear them.
- Legacy checkpoints that omit metadata or password state retain the prior set.
- Schema `3` owns these fields. Current readers still accept pre-replacement
  schema `2` events. Older readers reject schema `3` before persistence instead
  of extending an epoch they cannot interpret.
- Remote security triggers remain hidden until their authorized checkpoint is
  visible. Every causal descendant of a hidden trigger is hidden with it.
- When rejected events contract the accepted graph, metadata is rebuilt from an
  empty state so removed grants cannot survive in session caches.

Non-genesis events are also checked against the event's causal past. An actor is
accepted only if it is:

- the import root;
- introduced by a causally prior `join-approved` /
  `sentinel-participant-enrolled`; or
- publishing its own self-signed membership event under a narrow policy:

| Event | Self-signed rule |
| --- | --- |
| `join-requested` | Always allowed when self-signed (pending join) |
| `join-approved` | Self-signed only for simple password QR self-enrol, and only when causal ancestry has no Sentinel membership/share ops (`sentinel-participant-enrolled` / `sentinel-shares-issued`) |
| `sentinel-participant-enrolled` | Never self-signed; must be signed by an already-authorized actor (owner approval / genesis) |

The current event body requires the signing-key field. The shared signing-key
type explicitly distinguishes `Unavailable` from a validated Ed25519 hex key.
Current signed events reject `Unavailable`. Missing fields are not backfilled or
accepted through a compatibility shape.

Every encrypted secret payload also requires two non-empty vault-keyed tags:

- `identity_fingerprint` identifies the logical item while excluding its
  password/secret value and provider metadata;
- `fingerprint` identifies one complete secret version, including the
  password/secret value and bound to the logical identity.

They cannot be collapsed. Matching identity with a different version is how
import reconciliation preserves a changed password as a separate item instead
of silently overwriting it.

### Sentinel genesis correction

The target Sentinel lifecycle does not build a vault roster incrementally through
pre-genesis events. Participant public keys are collected in a separate typed
genesis session before a `store_id`, vault event set, or authorized actor graph
exists. Atomic Sentinel genesis creates the initial authorized roster, policy, and
complete encrypted share commitments together. The current
`sentinel-participant-enrolled` / `sentinel-shares-issued` sequence is implementation
debt and must not be treated as the target protocol. See
[sentinel-genesis.md](sentinel-genesis.md).

## Canonical encoding

Events are hashed and signed over **canonical JSON**:

- object keys sorted lexicographically at every level;
- array order preserved (`parents` sorted before signing);
- `created_at` is audit/UI only — never used for merge correctness.

Implementation: `nook-app/nook-platform/nook-event-log/src/canonical.rs`.

## Causal model

Each event lists all locally observed heads in `parents`. Therefore:

- **before:** ancestor in the DAG;
- **concurrent:** neither event is an ancestor of the other;
- **join:** a later event references both heads.

Unknown-parent events stay **pending** until dependencies arrive.

Provider-neutral parent indexing, heads, ancestry, concurrency, pending events,
topological order, and set union live in
`nook-app/nook-platform/nook-replication/src/causal_graph.rs`. Vault event-envelope validation
and actor authorization live in `nook-app/nook-platform/nook-event-log/src/graph.rs`.

## Domain projection

The reducer (`nook-app/nook-platform/nook-event-log/src/projection.rs`) must yield the same
result for every permutation of the same valid event set.

| Operation | Semantics |
|-----------|-----------|
| `secret-created` | Grow-only; idempotent duplicate |
| `secret-deleted` | Tombstone when delete is causal descendant of create |
| `secret-replaced` | Atomic tombstone + new record |
| Concurrent replacements | Both new records live; conflict group on old id |
| `secret-conflict-resolved` | Tombstones rejected candidates and causally clears the conflict |
| Independent concurrent adds | Both preserved |
| Concurrent creates with the same login identity (same website+username, different secret ids / passwords) | Both preserved as separate live secrets — **no password merge, no LWW**; neither password may be dropped. Sync is not import enrich/dedup. |
| `device-revoked` / password rotate/remove | Starts new **key epoch** with fresh vault keys and checkpoint |
| Concurrent security epochs | Security conflict — fail closed; local edits are blocked until all devices sync/recover |

File-sync disconnect/reconnect coverage (shared vault bucket cleared, offline concurrent
`login-a-1` creates, reconnect):
`nook-app/nook-platform/nook-core/tests/event_log_file_sync_replication.rs`.

## Key epochs

Password rotation, password removal, and device revocation rotate
`secrets_key` / `members_key` so append-only history cannot resurrect access.
Epoch identity is the rotation **event id**, not a global integer.

The implemented epoch path creates fresh vault keys, re-encrypts live secrets,
rewraps auth/member metadata for remaining authorized entries, and appends an
immutable `epoch-checkpoint`. Concurrent security rotations are detected in the
projection, surfaced through WASM/UI, and fail closed for further local edits.
Revocation metadata remains staged until the trigger/checkpoint pair commits.
A failure before that atomic commit restores the live session metadata. A
failure after commit keeps the revoked metadata active because the durable
security epoch already excludes that device.

## Provider interface (target)

```text
list_event_ids(provider, store_id, cursor?)
fetch_event(provider, store_id, event_id)
put_event_if_absent(provider, store_id, event_id, bytes)
```

No `update_event` or `delete_event` in v1.

The active provider adapters are GitHub, Google Drive, and iCloud.

Provider synchronization rules:

- During outbox flush, upload queued events that are absent remotely. Then
  repair the provider with any missing local event-store events.
- During pull, validate fetched remote event hashes and signatures. Ignore
  events whose signed body belongs to another `store_id`.
- Publish epoch checkpoints before triggers for every provider, including local
  folders. Quarantine incomplete pairs and descendants.
- Treat old-frontier concurrency as a blocking conflict. Commit import unions
  in one IndexedDB transaction.
- Keep schema v2 readable while schema v3 owns replacements.
- Let Simple vaults adopt authorized keys before replay. Clear missing
  authorization. Require a new Sentinel ceremony.
- Use a complete trigger/checkpoint pair for password rotation.
- Classify the provider event set before writing outbox or repair events.

| Provider state | Action |
| --- | --- |
| Empty | May be initialized from the active local vault |
| Exactly the active `store_id` | May be union-synced |
| Different `store_id` | Fail closed before any write |
| Multiple discovered `store_id`s | Fail closed before any write |
| Unreadable event files | Fail closed before any write |
| Invalid event bytes | Fail closed before any write |

The user must choose an explicit recovery/import path. The current local vault
must not silently take over provider data.

Event-log provider sync never writes the materialized projection. Normal
provider fan-out appends YAML event files. It repairs missing provider events
from the local event store.

Drive event storage tolerates duplicate app-data files for the same event name.
Fetch:

- downloads all matches;
- skips unreadable or wrong-id candidates;
- accepts only bytes whose content-derived event id matches the requested id;
- treats identical duplicates as one event; and
- reports divergent valid envelopes as corruption.

When every same-name candidate is unreadable, the event is treated as absent.
`put-if-absent` can then publish good local bytes. Outbox flush must not treat a
listed name alone as proof the event is already present.

Drive list only counts files whose `appProperties.event_id` matches the filename
digest. Name-only junk cannot inflate assess/sync downloads. Provider sync
fetches only remote event ids that are missing locally.

## IndexedDB storage

`nook_db` version `2` separates event-log state into dedicated object stores:

| Store | Purpose |
|-------|---------|
| `events` | Immutable event bytes and event indexes |
| `outbox` | Durable per-provider retry queue |
| `projections` | Projection heads and key-epoch markers |
| `provider_receipts` | Reserved for compact per-provider sync receipts |
| `vault` | Local projection cache plus device/signing identity material |

Event-log reads and writes use the separated stores. Event heads, key epochs,
event bytes, and outbox rows must not be read from any other `IndexedDB` object
store. Vault creation appends genesis directly; projection YAML is never an
event source.

## Rollout phases

| Phase | Scope |
|-------|--------|
| 0 | This ADR |
| 1 | `nook-replication` causal/replica mechanics plus `nook-event-log` event model, authorization, and projection |
| 2 | Ed25519 device keys, epoch crypto, actor authorization |
| 3 | IndexedDB event store, outbox, projection cache |
| 4 | GitHub / Drive event adapters |
| 5 | WASM manager + UI |
| 6 | Provider projection removal — **done** (event log is the only provider write path) |

## Testing requirements

Nook uses a **causal DAG** (parent head sets), not scalar vector clocks. Concurrency is `are_concurrent(a, b)` — neither event is an ancestor of the other. Sync is **set union** of immutable events.

These behaviors must be covered by **Rust tests** (~99% of sync correctness). E2e does not substitute.

| Scenario | Test location |
|----------|---------------|
| Generic causal ordering, pending parents, union | `nook-replication/src/causal_graph.rs` |
| Generic outbox idempotence and repair planning | `nook-replication/src/replica_store.rs` |
| Concurrent append, both secrets live | `nook-event-log/src/graph.rs`, `nook-event-log/src/projection.rs`, `event_log_workflow.rs` |
| Out-of-order delivery → pending → applied | `causal_graph.rs`, `nook-event-log/src/graph.rs`, `nook-event-log/src/store.rs`, `event_log_workflow.rs` |
| Join event collapses multiple heads | `nook-event-log/src/graph.rs`, `event_log_workflow.rs` |
| Replacement / security conflicts | `nook-event-log/src/projection.rs`, `nook-event-log/src/epoch.rs` |
| Multi-device decentralized union | `event_log_workflow.rs` (harness) |
| Projection replay invariance | `nook-event-log/src/projection.rs` (`assert_projection_permutation_invariant`) |
| Provider outbox + union | `event_log_workflow.rs`, `nook-event-log/src/store.rs` |

When adding operations or merge rules, add colocated unit tests **and** extend the harness scenarios if multi-device behavior changes.

**Coverage:** `task rust:coverage:check` enforces a combined **90%** line floor
for `nook-replication`, `nook-event-log`, `nook-core`, and `nook-auth2`
(`nook-app/nook-platform/nook-core/coverage-floor.json`). Replication mechanics
(`causal_graph`, `replica_store`) and vault policy modules
(`graph`, `projection`, `store`) are high-priority
for behavior-focused tests when sync semantics change or coverage drops below
90%.

## Related

- [#112](https://github.com/meta-secret/nook/issues/112) — full specification
- [#12](https://github.com/meta-secret/nook/issues/12) — multi-provider platform
- [#52](https://github.com/meta-secret/nook/issues/52) — schema versioning
- [unified-vault.md](unified-vault.md) — superseded whole-blob model
