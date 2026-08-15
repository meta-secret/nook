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

An `epoch-checkpoint` persists `secrets`, `members_checkpoint_hash`, and the
complete rewrapped `rotated_meta_records` and `password_entries` sets.
Projection replaces the prior sets; legacy checkpoints that omit password state
retain it. Schema `3` owns these fields, while current readers still accept
pre-replacement schema `2` events. Older readers reject schema `3` before
persistence instead of extending an epoch they cannot interpret.

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

Security epoch pairs use a visibility gate across providers that cannot commit
multiple files atomically. The checkpoint is published before its trigger. A
checkpoint whose trigger is not visible remains pending. A trigger whose
checkpoint is not visible is not admitted to the local graph. Descendants
therefore cannot extend an incomplete key transition.

Event schema v3 owns checkpoint replacement fields. Current readers accept
legacy v2 events, while pre-v3 readers reject new events before persistence.
Legacy password-envelope upgrades use a non-epoch operation; password rotation
remains a complete trigger/checkpoint transition.

Provider publication may leave the old frontier temporarily appendable. Any
event concurrent with an epoch trigger, including an access grant or ordinary
vault mutation, becomes a blocking security conflict.

Provider imports revalidate the complete union in the IndexedDB transaction
that writes bytes and heads, serializing with local appends and epoch commits.

The import quarantines a legacy local trigger and every descendant when the
trigger lacks a verified checkpoint. The active index and future outbox flushes
exclude that transition before it can become remotely appendable.

An unlocked Simple-vault session adopts the projected epoch's rewrapped auth
envelopes and persists the new key-epoch marker before projection replay. A
revoked device, missing envelope, or Sentinel epoch transition clears in-memory
vault keys and requires the appropriate unlock ceremony before writes resume.

Provider connect and sync paths must classify the provider event set before
writing outbox or repair events.

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
