# Devices & access

## Product statement

- **Surface:** **Devices & access** is Nook's identity-management surface.
  - It is available before a vault exists, while every vault is locked, and
    while a vault is open.
- **Identity:** An identity is a logical account.
  - It connects protected Nook apps to vault access.
  - App keys implement that relationship internally.
  - It owns per-vault DEKs.
- **Scope:** Explain identity, protection methods, apps, and the vaults that
  identity can open.
  - Do not present this as a universal passkey manager.
- **User abstraction:** Present passkeys or PINs as protection methods.
  - Present each protected installation as an **App** beneath that method.
  - Never present an app key as a peer user-managed key.
  - Keep the public app ID inside an explicit advanced disclosure.
- **Browser extension:** Treat it as another app installation.
  - Extension setup enrolls its internal app key into a selected identity.

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

Stored access facts remain typed by provenance:

- **verified by Nook** — cryptographic app-key unlock or vault open succeeded;
- **reported by browser** — WebAuthn attachment, transports, backup flags,
  AAGUID, or ceremony metadata;
- **named by the user** — the passkey name shown in its inventory row;
- **last-known** — cached evidence from an earlier session; or
- **unknown** — unavailable, unsupported, or predating collection.

WebAuthn cannot inventory external passkey managers.
The primary dashboard must not present browser ceremony metadata as product
information.

Registration evidence may include an authenticator GUID.
Nook maps known GUIDs to a typed keeper name such as Apple Passwords,
Proton Pass, or Google Password Manager.
That name is internal diagnostic metadata.
It is not an inventory of the keeper.

A synced passkey is shown as provider-available.
It is never shown as stored on one physical laptop.

## Persistence boundary

- **Local identity keyring:** Use `local_identity_keyring_v1`.
  - Bind each local identity ID to one independently generated app ID.
  - Store only the wrapped app key and an app-key-sealed event-signing seed.
  - Commit the new keyring entry and identity-directory entry in one IndexedDB
    transaction.
  - Select a new identity only after both records are durable.
  - Migrate legacy `app_id` and `app_key_wrapped` into the selected identity's
    keyring entry.
  - If an older tab writes a new wrapper for the same app ID, adopt that wrapper
    without replacing the entry's protected signing seed.
  - Delete the legacy wrapper only after the reconciled keyring is durable.
  - Dual-read legacy `device_id` and `device_identity_wrapped` only during that
    migration.
  - Store descriptive dashboard data in a separately versioned access profile.
  - Key each access profile by its local app ID.
  - Missing descriptive data must not prevent app-key unlock.
  - Key identity-sealed sync-provider snapshots by local app ID.
  - Migrate the legacy singleton provider snapshot only when it belongs to the
    sole local keyring entry.
  - Delete a competing legacy provider snapshot only when its normalized stored
    value matches the identity-scoped snapshot.
  - Preserve both provider snapshots and fail closed when their values differ.
  - A locked pre-sealed provider import must claim eligible legacy grants before
    it writes the first app-scoped snapshot.
  - An unlocked manager may write live provider grants only when its in-memory
    app ID matches the grant. Otherwise use the grant's explicit app scope.
  - Extension event import must resolve the protected local key by the grant's
    explicit app ID. It must not substitute the persisted directory selection.
  - Bind the grant's protected local identity selection before importing event
    bytes or provider state. If activation is blocked, abort without either
    mutation.
  - When an extension grant targets another local app ID, select its owning
    protected identity and lock the prior live session before reporting import
    success. The next extension unlock must target the imported grant.
  - Clear decrypted provider grants and provider drafts from web memory
    immediately after an Add identity protection action persists and adopts
    another local app key.
  - Preserve local vault discovery while clearing identity-scoped provider
    secrets, so a cancelled identity unlock cannot hide the local unlock path.
  - Do not auto-open a known vault while **Devices & access** owns an identity
    transition. Re-enter the catalog-driven local unlock path only after the
    user leaves the dashboard.
  - Clear any pending extension handoff and its secrets before a local identity
    transition can adopt a different app key.
  - After a legacy wrapped app key authenticates, atomically promote it into the
    directory and keyring and seal its existing singleton signing seed.
  - Normal PIN or passkey unlock must finish that promotion when an earlier
    read already created a seedless keyring entry.
  - If that pre-vault legacy identity has no signing seed and no established
    signing public key, mint its first signer during promotion.
  - If established signing evidence exists but its seed is missing, fail closed
    instead of replacing the signer.
  - If a stored legacy signing seed does not derive the established membership
    public key, fail closed instead of rotating the event actor.
  - After keyring promotion, ordinary vault genesis must retain the signing seed
    only inside its app-key-sealed keyring envelope. It must not recreate the
    legacy plaintext singleton seed.
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
  - Bind extension-first staged genesis to the live authorizer app key.
  - If no live authorizer exists, bind it to the handed-off app key.
  - Never derive staged ownership from another tab's persisted selection.
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
  - Scope passkey metadata by app ID.
  - Delete a competing legacy access profile only when it matches the
    identity-scoped profile.
  - Preserve both access profiles and fail closed when their values differ.
  - Validate each passkey metadata write against the wrapped credential owned
    by that app ID, not the directory selection shared by other tabs.
- **Destructive local recovery:** Quiesce serialized storage work in every tab
  before deleting the inaccessible wrapped app identity.
  - Bind scoped recovery to the initiating tab's app ID instead of the shared
    directory selection.
  - Carry that explicit app ID from the rendered protected-identity snapshot so
    recovery remains targeted after reload and across cleanup retries.
  - Fail closed when that app ID no longer matches a readable directory and
    keyring.
  - When the directory is unreadable but the versioned keyring is valid, use a
    full local-identity reset because identity-to-key ownership cannot be
    established safely.
  - Abort before any write when the versioned keyring cannot be decoded or
    validated.
  - Remove only the explicitly targeted identity's keyring entry.
  - Preserve unrelated local identities and their wrapped app keys.
  - Preserve the selected surviving local identity. Choose another survivor
    only when recovery retired the prior selection.
  - Preserve a Simple genesis marker owned by a remaining local identity.
  - Reject scoped recovery when a pending Sentinel finalization marker cannot
    be attributed safely.
  - Remove only the retired app key's provider snapshot when another local
    identity remains.
  - If cleanup fails after the identity transaction commits, resume the cleanup
    target recorded by the durable marker even when another identity is now
    selected.
  - While that durable cleanup marker remains, block local identity creation and
    activation so a stale cleanup cannot erase replacement credentials.
  - Locked recovery uses the initiating manager's retained app ID before it
    consults persisted selection. A new manager without a retained app ID may
    resolve the persisted selected app ID.
  - Keep the local vault registry so recovery does not erase discoverable vault
    locations.
  - Keep destructive recovery visible when identity-directory metadata is
    corrupt or future-incompatible. An unreadable directory must not trap the
    browser in an error state with no recovery action.
  - When recovery leaves only peer-owned identity members and no local keyring
    entry, allow the ordinary protection flow to create a new independent local
    identity after recovery cleanup completes.
  - Never let a racing peer write restore the retired identity after cleanup.
  - After scoped recovery quiesces peer tabs, reload those tabs on both success
    and failure so none remain permanently suspended from storage work.
  - If recovery preserves another local identity, direct the user to unlock a
    remaining identity. Ask for a new passkey only when no local identity
    survives.

## Interaction requirements

The Access canvas is identity-centric:

- center: the selected **Identity** hub;
- left: passkeys or PINs with their subordinate Nook apps;
- right: vaults whose DEKs the identity holds;
- edges: protection method → app → identity → vaults.

Current dashboard requirements:

- Login and authenticated **Access** share the same identity dashboard.
- Login opens `/devices-access`.
- Browser Back and Forward must update the locked dashboard from the current
  workspace route.
- `/vault` remains the secrets workspace only.
- Create-vault flows require identity creation first when no identity exists.
- The primary desktop layout uses a persistent identity rail.
  - Every local identity remains visible while one identity is selected.
  - Each identity row shows its app count and vault count.
  - Narrow screens stack the identity navigator above the selected identity.
- Selecting an identity changes the local browse context without changing the
  persisted authorization selection.
- The directory and access evidence derive current-installation ownership from
  the same live Rust session app key.
  - Rust returns the directory, current-browser ownership, and access evidence
    in one identity-bound snapshot. Presentation code must not resolve them as
    independent requests.
  - A locked browser may fall back to its persisted protected app ID.
  - A locked tab that retains an app ID must resolve that exact local keyring
    entry even when another tab changes the shared directory selection.
  - An unlocked tab must resolve vault creation and other identity-owned
    mutations from its live app key. Another tab's persisted selection cannot
    redirect or block those operations.
  - A companion session must not inherit the persisted browser app ID.
  - Rust/WASM projects each identity's locally known vault-access rows together
    with the identity directory. Presentation code must not infer grants by
    intersecting identity and vault snapshots.
  - A combined snapshot carries the manager's real unlock state. Retaining a
    public app ID after lock must not present the identity as unlocked.
  - Each local identity's vault rows use only access profiles belonging to that
    identity's local app keys.
- **Add identity** is the primary rail action.
  - It reveals the existing browser-protection widget in the detail column.
  - Opening or cancelling the widget is non-persistent and must not advance the
    cross-tab storage generation.
  - The widget creates a distinct passkey- or PIN-protected app key.
  - Pending Simple or Sentinel vault creation, or unfinished recovery cleanup,
    blocks identity creation and activation until that transition finishes.
  - Cancelling or failing protection leaves the prior unlocked web and Rust
    session, directory, and keyring unchanged.
  - Leaving after passkey fallback restores the selected identity's persisted
    protection state instead of retaining the setup-only PIN state.
  - If navigation closes the dashboard while a browser protection ceremony is
    running, defer cancellation of the immutable creation intent until that
    Rust/WASM action settles. Do not access the manager concurrently.
  - Clear the prior vault UI session only after new protection commits and Rust
    adopts the new app key.
  - Successful protection adds and selects the identity atomically.
- The browser-protection widget does not appear at the bottom of the default
  dashboard.
- Selecting an identity protected on this browser offers **Use identity**.
  - Activation changes the persisted selection.
  - Activation uses ordinary serialized storage and does not advance the
    destructive-recovery storage generation.
  - Other tabs retain their live app-key sessions after activation.
  - The prior in-memory app key, vault session, pending extension handoff, and
    decrypted provider state are cleared.
  - The selected identity must authenticate before opening vaults.
- The selected identity defaults to a protection and app inventory.
  - The current protector appears as the managed row.
  - Apps connected to the identity appear beneath that row.
  - Apps with no locally known protector appear in an app group.
  - Another installation is described as linked to the identity.
  - The UI must not claim that the current passkey unlocks that installation.
  - The passkey row owns its rename action.
  - App names from another installation are read-only.
  - The public app ID appears only after opening **Advanced**.
  - Internal app-key terminology does not appear in the primary inventory.
- A List/Graph control switches between the flat key inventory and relationship
  graph for the same selected identity.
  - The representations are mutually exclusive and never appear one after the
    other in the same content area.
  - The graph is supporting access detail rather than the primary identity
    selector.
  - Vault browsing remains available inside that relationship detail.
  - It renders only when the browsed identity owns the current browser app key.
  - Another installation receives an explicit local-key-unavailable state.
- The relationship graph labels the internal app-key node as **App**.
  - It reads as protection method → app → identity → vault.
  - Raw app-key identifiers and cryptographic terminology remain internal.
- **Add app** must not imply success before explicit identity enrollment
  exists.
  - The control explains that another installation must request enrollment.
- The primary surface omits access-evidence inspection and browser-reported
  ceremony fields.
- Raw passkey credential bytes never appear.
- The Access frame uses a wider measure than the secrets workspace so Graph
  and the key inventory can occupy the content column.

## Related records

- [identity-vault-architecture.md](../design-docs/identity-vault-architecture.md)
- [vault-event-log.md](../design-docs/vault-event-log.md)
- [browser-extension.md](browser-extension.md)
