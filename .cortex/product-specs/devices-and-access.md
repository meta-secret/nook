# Devices & access

## Relationships

- [Identity, App Keys, Passkeys, and Vault DEKs](../design-docs/identity-vault-architecture.md)
  - Separates identity, app-key, vault-key, onboarding, and grant responsibilities.
  - Read before changing the related architecture or security boundary.
- [Vault Event Log](../design-docs/vault-event-log.md)
  - Defines immutable vault events, ordering, concurrency, and provider synchronization.
  - Read before changing the related architecture or security boundary.
- [Browser Extension Product Spec](browser-extension.md)
  - Defines the companion extension boundary, approval, authentication surfaces, and storage rules.
  - Read when this document touches the related product behavior or user flow.
- [Nook Coding Rules & Golden Principles](../rules.md)
  - Defines the repository-wide implementation, testing, tooling, and delivery constraints.
  - Apply throughout implementation and review.

## Document map

- [Product statement](#product-statement)
  - Defines Devices & access as an identity-management surface, not a vault list.
  - Read before changing the dashboard's purpose or terminology.
- [Identity and access model](#identity-and-access-model)
  - Defines the person, identity, vault-grant, provider, and app-installation graph.
  - Read when changing authorization relationships or navigation.
- [Evidence and provenance](#evidence-and-provenance)
  - Separates verified facts, user labels, browser observations, and unknowns.
  - Read before displaying, persisting, or inferring access information.
- [Persistence boundary](#persistence-boundary)
  - Defines Rust-owned unlock records and browser-local identity metadata.
  - Read before changing storage, imports, app keys, or local reconciliation.
- [Interaction requirements](#interaction-requirements)
  - Specifies the identity-centric canvas, detail panels, labels, and access actions.
  - Read before implementing or reviewing Devices & access UI.
- [Related records](#related-records)
  - Routes to architecture and product records that own adjacent decisions.
  - Read when work crosses identity, vault, extension, or UX boundaries.

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
Readers normalize legacy directories that reused one app key across identities.
They merge the connected identities into the selected identity when possible.
If `pending_simple_genesis_v1` references a connected identity, that durable
identity survives instead and becomes selected.
The same transaction retains every member and vault grant, then rewrites the
normalized directory before enforcing unique app-key ownership.
A valid directory without duplicate app-key ownership does not decode or depend
on the pending-genesis marker.
Member records persist both encryption and event-signing public keys.
Missing signing keys from older records are unavailable, not inferred.
New Simple-vault genesis requires a verified signing key for every member.
Simple vault genesis uses `pending_simple_genesis_v1`.
The record contains `storeId`, `identityId`, `createdAt`, `eventState`, and
`flow`.
The flow is explicitly `ordinary` or `staged`.
The staged variant owns the base directory and inactive candidate directory.
Writers also emit the legacy `stagedIdentity` projection for already-open tabs.
Current readers reject conflicting current and legacy staged state.
The marker is durable before event creation and survives reloads.
Successful verified connect publishes the staged directory and matching signing
seed, then removes the marker in one compare-and-write transaction.
Unrelated concurrent identity and selection changes survive a typed three-way
rebase. A concurrent change to the staged identity fails closed.
Cross-identity app-key overlap also fails closed.
The staged marker remains durable so publication can retry without losing the
candidate directory or signing state.
Legacy records without `createdAt` use the Unix epoch timestamp.
`eventState` is `awaiting-event`, `legacy-event-pinned`, or `event-pinned`.
The current pinned variant owns the complete signed genesis event in
`eventYaml`, an app-key-sealed `signingSeedEnvelope`, and signer envelopes for
the staged members before the first event-log write. Retries by either staged
member open and reuse that exact pair.
A legacy marker without `eventState` is treated as `awaiting-event`.
A preceding top-level `eventYaml`, or an `event-pinned` state without seed
material, migrates to `legacy-event-pinned`. It upgrades to the current pinned
state only after the durable seed is verified against the event signer.
Legacy plaintext seed migration performs that verification before sealing.
Failed extension-first creation leaves active identity state unchanged.
Pre-event attempts remain staged; pinned or partially written genesis resumes
from the same marker. Decrypted UI state and sync are cleared before the failure
is shown.
Existing-vault imports use a separate pending state. One transaction validates
the active signed roster, synthesizes identity ownership, and commits the member
signer and adopted signing seed.
Every event named by the transactional roster index must exist and have a valid
event ID. Missing or malformed indexed evidence fails authorization closed.
Legacy-vault DEK reconciliation uses only active signed event approvals after
revocation replay.

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
