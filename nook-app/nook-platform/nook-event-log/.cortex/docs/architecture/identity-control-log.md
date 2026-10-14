# Identity Control Log

## Overview

**Status:** Implemented in `nook-event-log` (`identity_control`), the
identity mount plan in `nook-core`, and browser storage and sync in
`nook-wasm`.

The identity control log is the replicated membership authority of one
identity. Vaults are built on top of it: a vault belongs to exactly one
identity, and an installation reaches a vault through the identity that owns it.

- **Records:** app-key members, pending joins, revocations, per-vault DEK
  envelopes, and credential-free sync-provider mounts.
- **Mechanics:** the vault log's canonical JSON, Ed25519 actor signatures, and
  causal DAG.
- **Namespace:** its own remote and local namespace. Identity events never
  enter a vault event set, and vault events never enter an identity event set.

See [identity-vault-architecture.md](../../../../.cortex/docs/architecture/identity-vault-architecture.md)
for the identity and vault domain model and
[vault-event-log.md](vault-event-log.md) for the vault log it composes with.

## Required actions

### Sign every identity event as its actor

Each event body binds the identity it belongs to and the member that wrote it.

- **Body fields**
  - `schema_version`: `1`.
  - `identity_id`: the `idn_` identifier of the owning identity.
  - `actor_id`: SHA-256 digest of `actor_signing_public_key`.
  - `actor_signing_public_key`: the writer's Ed25519 key, hex encoded.
  - `parents`: every applicable head the writer observed.
  - `created_at`: audit and UI time only; never merge input.
  - `operations`: one or more control operations.
- **Identity:** the event ID is `sha256u:` over canonical body bytes, as in
  the vault log.
- **Signature:** Ed25519 over the canonical body, verified before insertion.
- **Genesis:** the parentless event holds exactly one `identity-created`
  operation, signed by the founder it names.

Envelope validation rejects a wrong identity, an unsupported schema, a second
genesis, a malformed member tuple, or a bad signature before the event is
indexed.

**Prohibited:** accept a remote `member-renamed` event because its signature
verifies, even though its `identity_id` names a different identity.

**Required:** reject the event at envelope validation. A valid signature proves
who wrote the bytes. It does not move the event into another identity's log.

### Record membership and access as typed operations

The operation set is closed. Every operation is kebab-case tagged on the wire.

- **`identity-created`**
  - Holds the founder's member keys.
- **`member-join-requested`**
  - Holds the joiner's member keys. It must be the event's only operation.
  - The actor must be the joiner's own signing key.
- **`member-approved`**
  - Holds the approved member's keys.
  - Holds one DEK grant per owned vault, wrapped to the member's encryption key.
- **`member-join-denied`**
  - Resolves a pending request without membership.
- **`member-revoked`**
  - Ends an app key's membership and drops its DEK envelopes from the projection.
- **`member-renamed`**
  - Replaces a member's label.
- **`vault-registered`**
  - Binds a vault `store_id` to the identity.
  - Holds the vault's key epoch and DEK envelopes for every active member.
- **`vault-dek-granted`**
  - Wraps one vault key epoch to every active member after a rotation.
  - Also closes the gap for members that joined concurrently with a
    registration.
- **`provider-mounted`** and **`provider-unmounted`**
  - Add or remove one credential-free mount record.

A member tuple carries `app_id`, the X25519 encryption public key, the Ed25519
signing public key, and a label. Validation derives `app_id` from the
encryption key and requires the signing key.

**Prohibited:** record a GitHub PAT or OAuth token inside `provider-mounted` so
a joining installation can sync without signing in.

**Required:** record only the repository, Drive folder, iCloud share target, or
local folder name. Each installation supplies and seals its own credential
locally, as [auth-providers.md](../../../../.cortex/docs/architecture/auth-providers.md)
requires.

### Keep names out of the signed log

The identity log is signed, not encrypted. Every mount's operator can read it.

- It carries public keys, device labels, wrapped DEKs, vault `store_id`s, and
  credential-free mount targets.
- Device labels follow the vault log's `join-approved` precedent.
- Identity names stay in the local directory and in the encrypted enrollment
  code.
- Vault names stay in the local vault registry and encrypted vault metadata.

**Prohibited:** add an `identity-renamed` operation so a rename on one
installation appears on the others.

**Required:** keep the identity name local. A provider operator must not learn
that the identity is called "Work" or that a vault is called "Taxes".

### Authorize actors from causal history

An event's actor must be an identity member in that event's causal past.

- The genesis actor is a member from genesis onward.
- `member-approved` makes the approved member's signer a member in every
  causal descendant.
- `member-revoked` removes membership unless a later approval causally follows
  the revocation.
- A revocation concurrent with an approval of the same app wins.
- A self-signed `member-join-requested` is the only operation an outsider may
  publish.
- An unauthorized event is quarantined with every causal descendant.

The projection applies the same rule over the whole applicable log, so the
member list never depends on delivery order.

**Prohibited:** let an approval delivered after a concurrent revocation restore
the revoked app because it was applied last.

**Required:** compare causal order, not arrival order. The approval only
survives when the revocation is its causal ancestor, so every replica agrees
the app is revoked.

### Project identity state deterministically

`IdentityControlState::project` folds applicable events in topological order.
Ties break by event ID.

- **Members:** the effective members with their latest labels.
- **Revoked:** app IDs that were members and are no longer effective.
- **Pending joins:** requests with no causally later approval, denial, or
  revocation for the same app, from apps that are not members.
- **Vaults:** each registered vault with DEK envelopes per key epoch.
  - The current key epoch comes from the latest registration or rewrap.
  - Revoked members' envelopes are removed.
- **Mounts:** mounted records minus unmounted ones.
- **Heads:** the applicable heads the next append extends.

**Prohibited:** open a vault with whichever identity envelope was granted last
when the vault has rotated its keys.

**Required:** look up the envelope for the vault's own current key epoch. A
missing envelope at that epoch is a typed `NotGranted` state that any holder of
the DEK can close with `vault-dek-granted`.

### Store the log once per provider mount

Every remote mount that can list a namespace stores the identity's log beside
its vaults. Events are immutable and content-addressed, so replicas converge
by set union.

- **Path-addressed providers (GitHub, local folder)**
  - Identity log: `nook-identity/v1/{identity_id}/events/{digest}.yaml`.
  - Namespaced vault: `nook-log/v1/vaults/{store_id}/events/{digest}.yaml`.
  - Legacy vault root: `nook-log/v1/events/{digest}.yaml`.
- **Google Drive**
  - Each namespace is a child folder of the row's event parent, named by
    `EventLogLocation::namespace_tag`.
  - The legacy root keeps listing only direct children, so namespaced files
    never enter a legacy vault's classification.
- **iCloud**
  - `CloudKit` cannot list by namespace until a record type for identity
    events is deployed to the production schema.
  - iCloud rows keep replicating the one vault they are bound to. They do not
    carry the identity log, and the Sync page says so.
- **Browser**
  - `nook_db.events` holds `identity_event:{identity_id}:{event_id}` rows and
    an `identity_event_index:{identity_id}` index in one transaction.

Identity sync lists each mount's identity namespace, fetches missing events,
validates them, unions them locally, then puts every local event the mount
lacks. A failed mount is reported on the Sync page and is retried by the next
sync.

**Prohibited:** write identity events into `nook-log/v1/events`, where a legacy
vault's classification guard reads every file as a vault event.

**Required:** write them under `EventLogLocation::Identity`. The legacy vault
root keeps exactly one `store_id`, and its fail-closed classification stays
unchanged.

### Migrate per-vault membership once

An identity with vaults but no control log is migrated by an installation that
can open those vaults.

1. Open each owned Simple vault's DEK at its current key epoch.
2. Read each vault's authorized roster from its signed event graph.
   - A device approved by `join-approved` and not revoked is authorized.
   - A revocation concurrent with an approval wins.
3. Write the founder-signed `identity-created` genesis.
4. Write one event with:
   - `member-approved` for each device authorized in at least one vault.
   - `vault-registered` per vault, wrapped to the devices that vault authorized.
   - `provider-mounted` for each existing provider row with a known target.
5. Report devices whose public keys do not form a valid member tuple.

A device revoked from any owned vault is not carried into the identity. A
member that one vault never authorized gets no envelope for it. The projection
lists it as missing that vault's current DEK.

**Prohibited:** make every device from any vault a member of every vault during
migration.

**Required:** wrap each vault's DEK only to devices that vault authorized. The
migration must not silently widen access that a vault-level decision limited.

## Prohibited actions

- Do not let a provider credential, an enrollment code, or a vault backup
  password grant identity membership.
- Do not accept an identity event whose actor is not an identity member in its
  causal past, except a self-signed join request.
- Do not store identity events in a vault namespace or vault events in the
  identity namespace.
- Do not persist private app keys, signing seeds, or plaintext DEKs in the
  identity log.

## Testing requirements

Behavior-focused Rust tests cover the log in
`nook-event-log/src/identity_control/tests.rs`,
`nook-event-log/src/location.rs`, and `nook-event-log/src/graph/roster.rs`.

- **Founder genesis, approval with DEK wrapping, member actions**
  - `approval_wraps_every_owned_vault_dek_to_the_joiner`
- **Outsider writes, impersonated requests, self-approval**
  - `outsiders_can_only_request_to_join`
- **Revocation, envelope removal, rewrap after rotation**
  - `revocation_drops_envelopes_and_blocks_later_actions`
- **Concurrent revoke versus reapproval**
  - `concurrent_revocation_wins_over_concurrent_reapproval`
- **Order independence and pending parents**
  - `projection_is_independent_of_delivery_order_and_resolves_pending_parents`
- **Identity binding, forged genesis, tampering**
  - `envelopes_bind_to_one_identity_and_one_founder_genesis`
- **Migration from vault rosters**
  - `migration_carries_authorized_vault_devices_into_the_identity`
- **Remote namespaces**
  - `namespaces_never_overlap_and_keep_the_legacy_vault_root`
