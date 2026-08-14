# Devices & access

## Product statement

**Devices & access** is Nook's identity-management surface.
An identity is a logical account.
It possesses passkeys and therefore app keys.
It owns per-vault DEKs.
The surface is available before a vault exists, while every vault is locked,
and while a vault is open.

It explains identity, passkeys, app keys, and vaults that identity can open.
It is not a universal passkey manager.

The browser extension is another installation with its own app key.
Extension setup enrolls that app key into a selected identity.

See
[identity-vault-architecture.md](../design-docs/identity-vault-architecture.md).

## Identity and access model

1. A person owns or joins zero or more identities.
2. An identity contains passkey records and app public keys.
   Creating a vault requires an identity with at least one key.
3. A passkey or PIN/passphrase protects a local app key (`app_id`).
   The app public key is a member of the identity.
4. The identity generates each vault DEK and wraps it to current app public
   keys.
   A vault cannot hold a DEK by itself.
5. Adding or removing an app key updates identity DEK envelopes.
   The vault log does not rewrite membership for that change.
6. A vault backup password opens only its owning vault.
   It does not replace identity or app-key unlock.
7. Sync providers are replication transports.
   They never grant identity membership or vault decryption by themselves.
8. Passwords and other secret items are vault content, not identity state.

## Evidence and provenance

Dashboard facts must be distinguishable as:

- **verified by Nook** — cryptographic app-key unlock or vault open succeeded;
- **reported by browser** — WebAuthn attachment, transports, backup flags,
  AAGUID, or ceremony metadata;
- **named by the user** — a reminder about where a passkey was saved;
- **last-known** — cached evidence from an earlier session; or
- **unknown** — unavailable, unsupported, or predating collection.

WebAuthn cannot inventory external passkey managers.
The dashboard must never imply that capability.

A synced passkey is shown as provider-available.
It is never shown as stored on one physical laptop.

## Persistence boundary

Unlock-critical records use `app_id` and `app_key_wrapped`.
Legacy `device_id` and `device_identity_wrapped` dual-read during migration
only.
Descriptive dashboard metadata uses a separately versioned access profile.
Missing descriptive data must not prevent app-key unlock.

The local identity directory uses `identity_directory_v1`.
Its selection is an explicit `Empty` or `Selected(identity_id)` state.
Updates use one IndexedDB read-write transaction.
Simple vault genesis uses `pending_simple_genesis_v1`.
The record contains `storeId`, `identityId`, `createdAt`, and `eventState`.
It is durable before DEK creation and survives reloads.
Successful verified connect removes only the matching marker.
Legacy records without `createdAt` use the Unix epoch timestamp.
`eventState` is `awaiting-event`, `legacy-event-pinned`, or `event-pinned`.
The current pinned variant owns the complete signed genesis event in
`eventYaml` and an app-key-sealed `signingSeedEnvelope` before the first
event-log write. Retries open and reuse that exact pair.
A legacy marker without `eventState` is treated as `awaiting-event`.
A preceding top-level `eventYaml`, or an `event-pinned` state without seed
material, migrates to `legacy-event-pinned`. It upgrades to the current pinned
state only after the durable seed is verified against the event signer.

Destructive local device recovery keeps retired app IDs in the directory.
Atomic directory updates reject those app keys. This prevents a stale browser
tab from recreating ownership after recovery. The initiating tab first asks
every open Nook tab to stop queued storage work and zeroize its app key. The
reset then runs inside the initiating tab's storage queue.
The directory reset and deletion of its current and legacy reconciliation
markers commit in one IndexedDB transaction. A failure cannot preserve stale
ownership after removing the encrypted epoch-recovery plan.

Security-epoch retry state uses
`pending_identity_reconciliation_v2:{store_id}`.
Its value pins `storeId`, `previousKeyEpoch`, `previousCheckpoint`, and tagged
`progress`. `prepared` contains an app-key-encrypted resumable plan with exact
signed trigger and checkpoint events. `epoch-committed` adds `key_epoch` and
retains `plan_envelope`. `committed` replaces the plan with the exact checkpoint
event ID. Connect must
resume prepared work before identity reconciliation.
Each identity-owned Simple vault DEK serializes `key_epoch`. Missing legacy
fields decode as tagged `legacy-unknown`; current `known` values carry both
`key_epoch` and `checkpoint` event IDs. Verified reconciliation performs the
upgrade, and current writers retain the compatibility variant.
The `identity_directory_v1` record stores retired installation keys in
`retired_app_ids`. Omitted legacy fields decode as an empty list. Destructive
device recovery appends removed member app IDs before clearing identities, and
current writers preserve the list permanently. A retired key cannot recreate
or reclaim identity ownership.
The app writes `prepared` before persisting the access-changing trigger. An
advanced epoch cannot be observed until the checkpoint is committed. That
checkpoint must remain in verified event history, while the
directory records the latest observed head. Same-epoch observations advance
that stored checkpoint only when it is a verified ancestor of the observed
head. The marker is compare-deleted only
after the identity directory compare-and-swap succeeds. Stale observations
cannot replace envelopes from a newer epoch.

The signed `epoch-checkpoint` operation stores `secrets`,
`members_checkpoint_hash`, and `rotated_meta_records`. Identity rotations fill
`rotated_meta_records` with the complete rewrapped auth and member record set.
Projection replaces the previous auth and member envelopes when that set is
non-empty. Omitted legacy fields decode as an empty list and retain the prior
metadata behavior. Clients that predate this field must upgrade before they
open or append to a rotated epoch. Current event schema `2` retains the field
until an explicit event-schema migration supersedes it.

On first read, the app migrates `identity_record_v1` into the directory.
It deletes the legacy key only after the new directory is durable.
Downgrading to a pre-directory build is unsupported after migration.
The local directory is separate from the future replicated identity control
log.

The dashboard may persist only non-secret metadata.
Private app keys, PRF output, PIN/passphrases, vault DEKs, backup-password
values, and plaintext vault contents are forbidden.

## Interaction requirements

The Access canvas is identity-centric:

- center: the selected **Identity** hub;
- left: passkeys and app keys that belong to that identity;
- right: vaults whose DEKs the identity holds;
- edges: passkey/app key → identity → vaults.

Current dashboard requirements:

- Login and authenticated **Access** share the same identity dashboard.
- Login opens `/devices-access`.
- `/vault` remains the secrets workspace only.
- Create-vault flows require identity creation first when no identity exists.
- An unprepared browser may start passkey or PIN protection from the
  dashboard.
- Technical identifiers use progressive disclosure.
  Raw passkey credential bytes never appear.

## Related records

- [identity-vault-architecture.md](../design-docs/identity-vault-architecture.md)
- [vault-event-log.md](../design-docs/vault-event-log.md)
- [browser-extension.md](browser-extension.md)
