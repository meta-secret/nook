# Devices & access

## Product statement

- **Surface:** **Devices & access** is Nook's identity-management surface.
  - It is available before a vault exists, while every vault is locked, and
    while a vault is open.
- **Identity:** An identity is a logical account.
  - It possesses passkeys and therefore app keys.
  - It owns per-vault DEKs.
- **Scope:** Explain identity, passkeys, app keys, and the vaults that identity
  can open.
  - Do not present this as a universal passkey manager.
- **Browser extension:** Treat it as another installation with its own app key.
  - Extension setup enrolls that app key into a selected identity.

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

Registration evidence may include an authenticator GUID.
Nook maps known GUIDs to a typed keeper name such as Apple Passwords,
Proton Pass, or Google Password Manager.
That name is browser-reported display help.
It is not an inventory of the keeper.
It must stay distinct from the optional user reminder.

A synced passkey is shown as provider-available.
It is never shown as stored on one physical laptop.

## Persistence boundary

- **Unlock-critical records:** Use `app_id` and `app_key_wrapped`.
  - Dual-read legacy `device_id` and `device_identity_wrapped` only during
    migration.
  - Store descriptive dashboard data in a separately versioned access profile.
  - Missing descriptive data must not prevent app-key unlock.
- **Local identity directory:** Use `identity_directory_v1`.
  - Represent selection as explicit `Empty` or `Selected(identity_id)`.
  - Apply updates in one IndexedDB read-write transaction.
  - Normalize legacy identities connected by a shared app key before enforcing
    unique ownership.
  - Prefer the selected identity as survivor unless a pending genesis marker
    durably references another identity in the connected group.
  - Retain every member and vault grant during the merge.
  - Normalize staged marker base and candidate directories in the same
    transaction so completion compares migrated snapshots.
  - Trigger staged snapshot normalization when either the live directory or
    staged base contains legacy duplicate ownership. Candidate-only duplicate
    ownership is a new invalid state and must fail closed.
  - Repeat that marker-aware normalization inside every directory write
    transaction, including authenticated handoff and staged genesis cleanup, so
    a pre-upgrade tab cannot race the initial migration.
  - Do not decode a pending marker for a valid directory without duplicate
    ownership.
  - Persist both encryption and event-signing public keys for members.
  - Treat missing signing keys from older records as unavailable, not inferred.
  - Require a verified signing key for every member in new Simple-vault genesis.
  - Reject an existing-vault handoff while any signed roster event is pending
    causal ancestry.
  - Require every stored event's computed ID to match its index and row key.
  - Validate the event index before writing a new event row.
  - On rejected handoff cleanup, scan by the vault event-row prefix.
  - Remove indexed and unindexed rows even when the index is malformed.
  - Apply the transactionally selected vault DEKs to the live session before
    reporting a successful handoff.
  - Attach an imported vault to the identity that already owns the authorized
    app key instead of synthesizing duplicate identity ownership.
- **Simple genesis marker:** Use `pending_simple_genesis_v1`.
  - Store `storeId`, `identityId`, `createdAt`, `eventState`, and `flow`.
  - Make `flow` explicitly `ordinary` or `staged`.
  - Let the staged flow own the base directory, inactive candidate directory,
    signing keys, and identity-owned DEK envelopes.
  - Validate the staged candidate even when the live directory still equals its
    base snapshot.
  - Emit the legacy `stagedIdentity` projection for already-open tabs and reject
    conflicting current and legacy staged state.
  - Make the marker durable before event creation and resume it after reload.
  - On verified connect, publish the staged directory and matching signing seed,
    then remove the marker in one compare-and-write transaction.
  - Fail closed on concurrent identity changes without overwriting them.
  - Retain unrelated concurrent changes through a typed three-way rebase.
  - Reject a staged-identity conflict or cross-identity app-key overlap.
- **Genesis event state:** Use `awaiting-event`, `legacy-event-pinned`, or
  `event-pinned`.
  - Let the current pinned variant own the complete signed `eventYaml`, an
    app-key-sealed `signingSeedEnvelope`, and staged-member signer envelopes
    before the first event-log write.
  - Let either staged member retry by opening and reusing that exact pair.
- **Legacy marker compatibility:**
  - Use the Unix epoch when `createdAt` is absent.
  - Treat a missing `eventState` as `awaiting-event`.
  - Migrate a preceding top-level `eventYaml`, or `event-pinned` without seed
    material, to `legacy-event-pinned`.
  - Upgrade only after verifying the durable seed against the event signer.
  - Verify a legacy plaintext seed before sealing it.
- **Failed or imported genesis:**
  - Leave active identity state unchanged after failed extension-first creation.
  - Keep pre-event attempts staged.
  - Resume pinned or partially written genesis from the same marker.
  - Clear decrypted UI state and sync before showing the failure.
  - Use a separate pending state for existing-vault imports.
  - Publish only after verified connect establishes the owning identity and
    validates the active signed roster.
  - Require every event named by the roster index to exist and have a valid
    event ID; missing or malformed evidence fails authorization closed.
  - Reject event rows absent from the index so a pre-upgrade split write cannot
    hide newer authorization evidence.
  - Reconcile legacy-vault DEKs only from active signed approvals after
    revocation replay.
- **Singleton migration:** On first read, move `identity_record_v1` into the
  directory.
  - Delete the legacy key only after the new directory is durable.
  - Do not support downgrade to a pre-directory build after migration.
  - Keep the local directory separate from the future replicated identity
    control log.
- **Dashboard persistence:** Store non-secret metadata only.
  - Never persist private app keys, PRF output, PIN/passphrases, vault DEKs,
    backup-password values, or plaintext vault contents.
- **Destructive local recovery:** Quiesce serialized storage work in every tab
  before deleting the inaccessible wrapped app identity.
  - Keep the local vault registry so recovery does not erase discoverable vault
    locations.
  - Never let a racing peer write restore the retired identity after cleanup.

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
- The primary desktop layout uses a persistent identity rail.
  - Every local identity remains visible while one identity is selected.
  - Each identity row shows the same visible key count as its inventory and its
    vault count.
  - Narrow screens stack the identity navigator above the selected identity.
- Selecting an identity changes the local browse context without changing the
  persisted authorization selection.
- The directory and access evidence derive current-installation ownership from
  the same live Rust session app key.
  - A locked browser may fall back to its persisted protected app ID.
  - A companion session must not inherit the persisted browser app ID.
  - Rust/WASM projects each identity's locally known vault-access rows together
    with the identity directory. Presentation code must not infer grants by
    intersecting independently loaded identity and vault snapshots.
- **Add identity** remains visible but unavailable until Nook can create and
  protect an independent app key for the new identity.
- An unprepared browser may start passkey or PIN protection from the dashboard.
- The selected identity defaults to a flat key inventory.
  - The current protector and current app key appear as separate rows.
  - Every other public app-key member also appears.
  - Protector provenance and last-used evidence remain explicit.
  - App keys from another installation are read-only.
  - They never open the current browser's detail evidence.
- A List/Graph control switches between the flat key inventory and relationship
  graph for the same selected identity.
  - The representations are mutually exclusive and never appear one after the
    other in the same content area.
  - Selecting inspectable key evidence from the list opens the graph at that
    evidence.
  - The graph is supporting access detail rather than the primary identity
    selector.
  - Vault browsing remains available inside that relationship detail.
  - It renders only when the browsed identity owns the current browser app key.
  - Another installation receives an explicit unavailable-evidence state.
- **Add a key** must not imply success before explicit identity enrollment
  exists.
  - The control explains that another installation must request enrollment.
- Technical identifiers use progressive disclosure.
  Raw passkey credential bytes never appear.
- The Access frame uses a wider measure than the secrets workspace so Graph
  and the key inventory can occupy the content column.

## Related records

- [identity-vault-architecture.md](../design-docs/identity-vault-architecture.md)
- [vault-event-log.md](../design-docs/vault-event-log.md)
- [browser-extension.md](browser-extension.md)
