# Vault Event Log

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
See [identity-vault-architecture.md](../../security/architecture/identity-vault-architecture.md).

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

- **Event ID**
  - **Rule:** SHA-256 of canonical body bytes (`sha256u:{base64url_no_pad}`)
- **Remote path**
  - **Rule:** `nook-log/v1/events/{digest}.yaml`
- **Writes**
  - **Rule:** append-only; `put_event_if_absent`
- **Duplicate identical event**
  - **Rule:** success (idempotent)
- **Same path, different bytes**
  - **Rule:** quarantine (corruption)

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

- **`join-requested`**
  - **Self-signed rule:** Always allowed when self-signed (pending join)
- **`join-approved`**
  - **Self-signed rule:** Conditional
    - Self-signing is only for simple password QR self-enrol.
    - Causal ancestry must have no Sentinel membership or share operations.
    - Those operations are `sentinel-participant-enrolled` and `sentinel-shares-issued`.
- **`sentinel-participant-enrolled`**
  - **Self-signed rule:** Never self-signed; must be signed by an already-authorized actor (owner approval / genesis)

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

- **`secret-created`**
  - **Semantics:** Grow-only; idempotent duplicate
- **`secret-deleted`**
  - **Semantics:** Tombstone when delete is causal descendant of create
- **`secret-replaced`**
  - **Semantics:** Atomic tombstone + new record
- **Concurrent replacements**
  - **Semantics:** Both new records live; conflict group on old id
- **`secret-conflict-resolved`**
  - **Semantics:** Tombstones rejected candidates and causally clears the conflict
- **Independent concurrent adds**
  - **Semantics:** Both preserved
- **Concurrent creates with the same login identity (same website+username, different secret ids / passwords)**
  - **Semantics:** Both preserved as separate live secrets — **no password merge, no LWW**; neither password may be dropped. Sync is not import enrich/dedup.
- **`device-revoked` / password rotate/remove**
  - **Semantics:** Starts new **key epoch** with fresh vault keys and checkpoint
- **Concurrent security epochs**
  - **Semantics:** Security conflict — fail closed; local edits are blocked until all devices sync/recover

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
failure after commit resets the complete live vault session. Reconnect resumes
the durable security-epoch recovery plan before ordinary edits are allowed.

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

- **Empty**
  - **Action:** May be initialized from the active local vault
- **Exactly the active `store_id`**
  - **Action:** May be union-synced
- **Different `store_id`**
  - **Action:** Fail closed before any write
- **Multiple discovered `store_id`s**
  - **Action:** Fail closed before any write
- **Unreadable event files**
  - **Action:** Fail closed before any write
- **Invalid event bytes**
  - **Action:** Fail closed before any write

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

- **`events`**
  - **Purpose:** Immutable event bytes and event indexes
- **`outbox`**
  - **Purpose:** Durable per-provider retry queue
- **`projections`**
  - **Purpose:** Projection heads and key-epoch markers
- **`provider_receipts`**
  - **Purpose:** Reserved for compact per-provider sync receipts
- **`vault`**
  - **Purpose:** Local projection cache plus device/signing identity material

Event-log reads and writes use the separated stores. Event heads, key epochs,
event bytes, and outbox rows must not be read from any other `IndexedDB` object
store. Vault creation appends genesis directly; projection YAML is never an
event source.

## Rollout phases

- **0**
  - **Scope:** This ADR
- **1**
  - **Scope:** `nook-replication` causal/replica mechanics plus `nook-event-log` event model, authorization, and projection
- **2**
  - **Scope:** Ed25519 device keys, epoch crypto, actor authorization
- **3**
  - **Scope:** IndexedDB event store, outbox, projection cache
- **4**
  - **Scope:** GitHub / Drive event adapters
- **5**
  - **Scope:** WASM manager + UI
- **6**
  - **Scope:** Provider projection removal — **done** (event log is the only provider write path)

## Testing requirements

Nook uses a **causal DAG** (parent head sets), not scalar vector clocks. Concurrency is `are_concurrent(a, b)` — neither event is an ancestor of the other. Sync is **set union** of immutable events.

These behaviors must be covered by **Rust tests** (~99% of sync correctness). E2e does not substitute.

- **Generic causal ordering, pending parents, union**
  - **Test location:** `nook-replication/src/causal_graph.rs`
- **Generic outbox idempotence and repair planning**
  - **Test location:** `nook-replication/src/replica_store.rs`
- **Concurrent append, both secrets live**
  - **Test location:** `nook-event-log/src/graph.rs`, `nook-event-log/src/projection.rs`, `event_log_workflow.rs`
- **Out-of-order delivery → pending → applied**
  - **Test location:** `causal_graph.rs`, `nook-event-log/src/graph.rs`, `nook-event-log/src/store.rs`, `event_log_workflow.rs`
- **Join event collapses multiple heads**
  - **Test location:** `nook-event-log/src/graph.rs`, `event_log_workflow.rs`
- **Replacement / security conflicts**
  - **Test location:** `nook-event-log/src/projection.rs`, `nook-event-log/src/epoch.rs`
- **Multi-device decentralized union**
  - **Test location:** `event_log_workflow.rs` (harness)
- **Projection replay invariance**
  - **Test location:** `nook-event-log/src/projection.rs` (`assert_projection_permutation_invariant`)
- **Provider outbox + union**
  - **Test location:** `event_log_workflow.rs`, `nook-event-log/src/store.rs`

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
