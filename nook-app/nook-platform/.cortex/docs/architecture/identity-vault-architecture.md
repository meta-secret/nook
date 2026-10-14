# Identity, App Keys, Passkeys, and Vault DEKs

## Overview

**Status:** Implemented.
The local identity directory, identity-owned DEKs, and the replicated
[identity control log](../../../nook-event-log/.cortex/docs/architecture/identity-control-log.md)
are implemented. Device onboarding and sync-provider mounts are identity-level.

Nook distinguishes a person, identities, passkeys, app keys, sync providers,
and vaults. None of these names are interchangeable.

## Normative vocabulary

- **Person / user**
  - **Meaning:** The human operator. One person may own or join multiple identities.
- **Identity**
  - **Meaning:** Logical authorization subject. It possesses passkeys and therefore app keys. It owns per-vault DEKs.
- **Passkey / device key**
  - **Meaning:** WebAuthn credential or PIN/passphrase fallback that protects a local app key.
- **App key**
  - **Meaning:** Installation-local asymmetric key for Simple, Sentinel, or the web extension. Replaces the former `DeviceIdentity` name.
- **`app_id`**
  - **Meaning:** Stable id for one app-key installation. Replaces the former `device_id` / `DeviceId` name.
- **Installation**
  - **Meaning:** Browser-origin or extension storage context that holds one app private key.
- **Sync-provider mount**
  - **Meaning:** Replication transport for an identity control log or vault event log. Not authority.
- **Vault**
  - **Meaning:** Encrypted secret event log addressed by `store_id`. It cannot exist without an authorizing identity.

Historical name `DeviceIdentity` means app key.
Historical name `device_id` means `app_id`.
Do not introduce those old names in new APIs.

## Domain map

```mermaid
flowchart TD
    subgraph UserDevice["User & Local Device"]
        Person["Person (User)"]
        Passkey["Passkey / PIN"]
        AppKey["Local App Key (app_id)<br/>(Private key in local storage)"]
        Person -->|"authenticates with"| Passkey
        Passkey -->|"unwraps local"| AppKey
    end

    subgraph IdentityDomain["Identity Domain"]
        Identity["Identity (A, B, ...)"]
        IdentityLog["Signed Identity Control Log<br/>(Members, public keys, mounts)"]
        DekEnvelopes["Per-Vault DEK Envelopes<br/>(DEK encrypted to App Public Keys)"]

        Person -->|"owns or joins 0..n"| Identity
        Identity -->|"governed by"| IdentityLog
        Identity -->|"generates & owns"| DekEnvelopes
        AppKey -.->|"public key registered in"| IdentityLog
        AppKey -->|"unwraps DEK from"| DekEnvelopes
    end

    subgraph VaultDomain["Vault Domain"]
        Vault["Vault (store_id)"]
        VaultLog["Encrypted Vault Event Log<br/>(Secrets, event DAG, projection)"]

        Identity -->|"authorizes & owns"| Vault
        Vault -->|"contains"| VaultLog
        DekEnvelopes -->|"provides DEK to decrypt"| VaultLog
    end

    subgraph ReplicationDomain["Replication Transport"]
        Provider["Replication Provider<br/>(GitHub, Drive, etc.)"]
        Provider -->|"syncs"| IdentityLog
        Provider -->|"syncs"| VaultLog
    end
```

## Identity domain

An identity is a logical account.
A person may keep separate identities for personal, work, family, or recovery
contexts.

An identity must have at least one passkey or PIN/passphrase protector before
it may create a vault.
That protector unwraps a local app key.
The app public key is a member of the identity.

The [identity control log](../../../nook-event-log/.cortex/docs/architecture/identity-control-log.md)
owns:

- a stable identity id;
- app-key members (`app_id`, X25519 encryption public key, Ed25519 signing
  public key, label), pending joins, and revocations;
- per-vault DEK records: vault `store_id` plus envelopes of that vault DEK to
  each active app public key, per vault key epoch;
- zero or more credential-free sync-provider mounts.

Passkey credential records, the identity name, and vault names stay in local
storage. The log is signed, not encrypted.

Private app keys never enter the replicated identity record.
Local private app keys live in `local_identity_keyring_v1`.
Each entry binds one identity ID to one wrapped app key.
Each entry also stores an app-key-sealed event-signing seed.
The browser writes the keyring and directory in one IndexedDB transaction.
Identity-sealed sync-provider snapshots use the same app ID as their storage
scope. Switching identities cannot attempt to open another identity's provider
credentials or overwrite them.
After an Add identity protection action persists and adopts another app key,
the browser clears the prior decrypted provider grants and provider drafts.
Cancellation or failure preserves the prior session. A committed local identity
transition also clears pending extension-handoff secrets.
An authenticated legacy wrapped key is promoted into the directory and keyring
with its singleton signing seed before the unlocked session is adopted.
When a pre-vault legacy identity has no signing seed or signing public key, that
promotion mints its first signer. Existing signing evidence without its seed
fails closed instead of silently changing signer identity.
Locked pre-sealed provider imports preserve eligible legacy grants before they
publish the first app-scoped provider snapshot.
Extension import binds the grant's protected local identity before importing
event bytes or provider state. A blocked activation leaves both untouched.
An extension grant imported for another app ID becomes the persisted local
selection. Any different unlocked app-key session is cleared before import
success so extension status cannot claim a usable session for the wrong grant.

### Local directory phase

The browser stores the local directory under `identity_directory_v1`.
The directory contains:

- zero or more `IdentityRecord` values;
- an explicit `Empty` or `Selected(identity_id)` state; and
- app IDs retired by destructive local recovery.

Older versions allowed one app key to appear in several identities.
Load migrates those records in the existing IndexedDB transaction.
It merges every identity connected by a shared app key.
The selected identity survives when it belongs to that group.
An identity referenced by `pending_simple_genesis_v1` takes precedence over
the selection so a resumable genesis marker cannot become orphaned.
When the marker is staged, the same transaction normalizes its base and
candidate directory snapshots before rewriting the live directory.
Cleanup repeats that snapshot migration when either the live directory or the
staged base contains legacy duplicate ownership. Duplicate ownership introduced
only by the candidate remains invalid and is rejected.
Every later directory update repeats this marker-aware migration within its
write transaction. Authenticated handoff and staged genesis cleanup preserve the
pending identity inside their transactions. A concurrent pre-upgrade writer
cannot absorb the pending identity between preflight migration and mutation.
All distinct members and vault DEK grants survive the merge.
The normalized directory is rewritten before unique app-key ownership is
enforced.
A valid directory without duplicate app-key ownership remains usable without
decoding a malformed or future pending-genesis marker.

Each identity member stores its X25519 encryption public key and Ed25519 event
signing public key. Older records decode a missing signing key as unavailable.
They cannot enter a new signed Simple-vault genesis roster until an authenticated
handoff or the local signer supplies that public key.

Destructive device recovery retires only the explicitly targeted local app key
whose protection became inaccessible.
The target comes from the initiating tab's rendered protected-identity snapshot,
not the directory selection shared by concurrent tabs.
It removes that keyring entry and its sealed signing seed in one transaction.
It preserves unrelated local identities.
It fails before writing when the versioned keyring is malformed, unsupported,
or inconsistent with the directory.
If the directory is unreadable but the independently validated keyring remains
valid, recovery performs a safe full local-identity reset because scoped
identity ownership cannot be established.
It preserves a Simple genesis marker owned by a surviving keyring entry.
It rejects scoped recovery when a pending Sentinel finalization marker cannot
be attributed to one identity safely.
When another local identity remains, recovery removes only the retired app
key's provider snapshot.
If later provider cleanup fails, a retry resumes the app ID recorded by the
durable recovery marker. It does not reinterpret the new directory selection as
the recovery target.
Identity creation and activation remain blocked until that marker is removed,
so a stale cleanup cannot delete a replacement identity's provider credentials.
The locked recovery entry point uses the initiating manager's retained app ID
first. Only a new manager without retained scope consults persisted selection.
It does not retire paired website, extension, or peer installation identities.
A malformed retired-app ledger cannot block recovery.
Recovery replaces it with valid retirement evidence before a replacement
identity may enroll.

- **Directory concurrency:**
  - Apply every directory update in one IndexedDB read-write transaction.
  - Prevent concurrent tabs from overwriting identity creation, selection,
    membership, or DEK changes.
  - Treat persisted selection as a new-session default, not live-session
    authority.
  - Resolve an already-open manager's vault creation and identity mutations
    from its authenticated app key when another tab changes selection.
  - Carry the manager's actual private-key unlock state into combined directory
    snapshots. A retained public app ID is identity scope, not unlock proof.
  - Load each local identity's vault-access rows from only its own app-scoped
    descriptive profiles.
- **Fresh-vault extension adoption:**
  - Stage extension identity adoption through vault initialization.
  - Bind the staged identity to the live authorizer app key.
  - If no authorizer exists, bind it to the handed-off extension app key.
  - Ignore another tab's persisted selection when deriving staged ownership.
  - Keep fresh-vault membership, signing keys, and per-vault DEK envelopes only
    in the resumable genesis marker until verified connect succeeds.
  - Compare the marker's base directory with the current directory during
    completion.
  - Publish the staged directory and matching signing seed, then remove the
    marker atomically.
  - Retain unrelated concurrent identity and selection changes through a typed
    three-way rebase.
  - Abort publication when the staged identity changed concurrently or app-key
    ownership overlaps another identity.
  - Retain a rejected marker so retry resumes the same candidate.
  - After a failed create, clear decrypted host state and stop background sync
    without rolling back event stores or active identity state.
- **Existing-vault import:**
  - Use a distinct pending handoff state.
  - During verified connect, synthesize the vault owner from active signed
    envelopes and verify the extension signing key against the active event
    roster.
  - If the authorized app key already belongs to an identity, add the imported
    vault grant to that identity rather than synthesizing a duplicate owner.
  - Reject the roster snapshot if its event index names a missing event or an
    invalid event ID.
  - Reject matching event rows absent from the index. This closes the
    pre-upgrade two-transaction writer window before authorization is trusted.
  - Parse every event row and require its computed event ID to match the index
    and row key before treating it as authorization evidence.
  - Reject a graph with pending events. A known revocation awaiting a missing
    parent must not leave an older approval usable for handoff.
  - Commit the member signer and adopted signing seed atomically.
  - Return the transactionally selected DEKs and install them in the live vault
    session before clearing the pending handoff.
  - Validate a staged candidate before both unchanged-base publication and
    three-way rebase publication.
- **Legacy-vault reconciliation:** Derive DEK recipients from the signed event
  graph's active approvals after revocations, not from stale encrypted auth
  rows.

Simple vault creation uses the following marker contract:

- Store `pending_simple_genesis_v1` in IndexedDB before any event-log state.
- Record `storeId`, `identityId`, `createdAt`, `eventState`, and `flow`.
  - `flow` is explicitly `ordinary` or `staged`.
  - The staged flow carries the base directory and inactive candidate directory
    with identity-owned DEK envelopes.
  - Writers also emit the legacy `stagedIdentity` projection for already-open
    tabs.
  - Reject conflicting current and legacy staged state.
- Resume the same store and identity binding after a reload.
- Block local identity creation and activation while a Simple or Sentinel
  genesis transition or local recovery cleanup remains pending.
- Remove the marker with a compare-and-delete transaction after verified
  connect completes.
  - An older tab cannot delete a newer genesis marker.
- Let the marker own the genesis timestamp and complete signed event lifecycle.
- Set `eventState` to `awaiting-event`, `legacy-event-pinned`, or
  `event-pinned`.
  - The current pinned variant owns the signed `eventYaml`, an app-key-sealed
    `signingSeedEnvelope`, and staged-member signer envelopes before the first
    event-log write.
  - Either authorized staged member can resume the exact signer and event after
    a reload.
- Decode legacy variants conservatively:
  - A marker without `createdAt` uses the Unix epoch timestamp.
  - A marker without `eventState` becomes `awaiting-event`.
  - A preceding top-level `eventYaml`, or an `event-pinned` state without seed
    material, becomes `legacy-event-pinned`.
  - Upgrade that state only after the durable seed matches the pinned event
    signer.
  - Apply the same signer check before sealing a legacy plaintext seed.

Destructive recovery clears identity ownership atomically while retaining a
fail-closed ledger of retired app IDs. Tabs quiesce before recovery. Separate
auth cleanup remains retryable after a partial failure. The exclusive recovery
lock advances the storage generation on success or failure. The initiating tab
adopts that generation before it performs another queued storage operation.
Identity DEK grants
store the verified observed epoch during import. Legacy omissions require
verified reconciliation. Locked remote sync persists the verified projected
epoch before password self-enrollment can append a membership event. The v2
reconciliation marker preserves resumable progress across reloads.

The first directory read migrates `identity_record_v1` when present:

1. decode the singleton record;
2. write a valid directory with that record selected; and
3. delete the legacy key only after the directory write succeeds.

Pre-directory builds cannot read the new key.
Downgrading after migration is unsupported.
The local directory caches the replicated identity control log. Identity sync
applies the log's members and DEK envelopes to the matching local record.

## DEK ownership

The identity generates each vault DEK.
The identity stores envelopes of that DEK to every current app public key.
The vault does not own a standalone DEK.
The vault cannot be created without an identity that already has:

1. at least one key; and
2. a generated DEK for that vault.

When an app key is added or removed, the identity re-wraps or drops DEK
envelopes in its control log.
The vault event log does not need an approver-written membership change.
A joined app key self-enrolls into each Simple vault log with the DEK it
already holds, and a revocation rotates each vault before its next write.

Rejected model: vault stores identity-versioned DEK blobs that rewrite on every
key add.

Legacy vault `auth:` and `members:` rows remain a wire-compatibility boundary.
Loaders synthesize an identity and move DEK envelopes onto identity-held
records.

## Vault domain

A vault owns:

- `store_id`;
- secret ciphertext under the identity-supplied DEK;
- signed vault event log and projection;
- a reference to its authorizing identity.

A vault does not own the member roster as authority.
Passwords and other secret items remain vault content.

Unlock path:

1. Passkey or PIN unwraps the local app key.
2. The app key unwraps the identity-held DEK envelope for that vault.
3. The DEK decrypts vault secrets.

## Passkey locality

WebAuthn backup eligibility remains browser-reported evidence.
A synced passkey has provider availability, not one asserted laptop location.
A synced passkey may unlock an installation's wrapped app key.
It does not copy the app private key between installations.

Target shape: fresh random locally wrapped app key per installation.
Deterministic passkey-derived app keys remain a compatibility boundary and
must not define the target model.

## Onboarding

An identity is built first. It gains app keys and sync-provider mounts, and its
vaults function on top of that infrastructure. Device onboarding and provider
mounts therefore act on the identity, never on one vault.

### Create the first vault

1. Create the identity.
2. Enroll a passkey or PIN and the local app key.
3. Generate the vault DEK and wrap it to the identity's current app keys.
4. Create the vault bound to that identity.
5. Register the vault in the identity control log with `vault-registered`.

**Prohibited:** create a vault from the hub before any identity exists, then
attach an identity later.

**Required:** create the identity and its key with the first vault. The vault
is registered in that identity's log from its genesis.

### Join an installation to an identity

1. An identity member issues an identity enrollment code.
   - The code names the identity and the mount the joiner can reach.
2. The joining installation decrypts the code and connects that mount.
   - Personal credential transfer carries the provider credential.
   - A shared grant carries only the target; the joiner signs in itself.
3. The joiner syncs the identity log from the mount.
4. The joiner appends a self-signed `member-join-requested` and pushes it.
5. A member sees the pending join on **Identity → Devices** and approves it.
   - The approver opens every owned Simple vault's DEK at its current key
     epoch.
   - `member-approved` wraps each DEK to the joiner's encryption key.
   - Approval fails when the approver cannot open an owned vault.
6. The joiner syncs again and adopts the identity.
   - Its local directory record gains the members and DEK envelopes.
   - Its identity card lists every vault the identity owns.
7. On the first open of each Simple vault, the joiner appends a self-signed
   `join-approved` to that vault's log with the DEK it holds.
   - This uses the existing Simple self-enrolment policy in
     [vault-event-log.md](../../../nook-event-log/.cortex/docs/architecture/vault-event-log.md).
   - No approver writes into any vault log.

A member may deny the request with `member-join-denied`.

**Prohibited:** approve a joiner by writing `join-approved` into the open vault
only, so the joiner sees one vault and must be approved again for each other
vault.

**Required:** approve once in the identity log. The approval wraps every owned
vault's DEK, and the joiner reaches each vault through the identity.

### Revoke an installation

1. A member appends `member-revoked` for the app key.
   - The identity always keeps at least one member.
2. The open vault rotates immediately.
   - Its log records `device-revoked` and an epoch checkpoint.
   - The identity log records `vault-dek-granted` for the new epoch.
3. Every other owned vault rotates before its next write.
   - Opening a vault compares its signed roster with identity membership.
   - A vault actor revoked from the identity is revoked from the vault first.
   - The rotation and its identity rewrap complete before any edit.

Revocation never protects data the revoked installation already decrypted. It
stops that installation from reading anything written afterwards.

**Prohibited:** revoke an app key in the identity log and let another vault
accept new secrets under its old key epoch.

**Required:** rotate that vault before its next write. The revoked app key
holds no envelope for the new epoch, so it cannot read later secrets.

### Keep Sentinel vaults on their ceremony

Sentinel vault keys are threshold shares, not a DEK the identity can wrap.
Identity approval grants a joiner the identity's Simple vaults only. A Sentinel
vault keeps its participant ceremony in
[sentinel-genesis.md](sentinel-genesis.md).

**Prohibited:** wrap a reconstructed Sentinel key bundle to a joiner during
identity approval.

**Required:** list the Sentinel vault on the joiner's identity card as needing
its ceremony. Identity membership never bypasses the threshold.

### Issue identity enrollment codes

The enrollment code invites an installation into an identity, not a vault.

- The encrypted payload holds the provider transport and
  `identity: { identity_id, label }`.
- The provider transport keeps the personal and shared typestates described in
  [auth-providers.md](auth-providers.md#shared-provider-onboarding).
- The outer envelope and its PBKDF2 and AES-GCM parameters are unchanged.
- Codes issued by earlier builds named a vault. They are short-lived invitations
  and fail closed as invalid codes; the member issues a new code.

**Prohibited:** keep `vault_name` in the payload so the joiner's identity card
can show the vault before approval.

**Required:** name only the identity. The joiner learns the identity's vaults
from the approved control log, which also carries their DEKs.

### Mount sync providers on the identity

Provider rows stay in the app-scoped `providers:{app_id}` snapshot, which is
already one local identity's storage. Each row records its remote layout.

- **Identity namespaced rows**
  - Replicate the identity log and every vault the identity owns.
  - Use the namespaced paths in
    [identity-control-log.md](../../../nook-event-log/.cortex/docs/architecture/identity-control-log.md#store-the-log-once-per-provider-mount).
- **Legacy vault root rows**
  - Rows saved before identity mounts keep their one vault at the legacy root.
  - They also carry the identity log in its own namespace.
- **iCloud rows**
  - Stay bound to the vault they were added from until `CloudKit` can list a
    namespace.
- **Mount records**
  - The identity log records each remote row's credential-free target.
  - A joining installation sees recorded mounts it has not connected and
    connects each with its own credential.
  - A joining installation saves its row before it can read the log. Once
    the log arrives, the row takes the layout recorded for its target: a
    namespaced record wins, and a legacy record binds the row to that vault.

**Prohibited:** add a GitHub provider while vault A is open and leave vault B
of the same identity without replication.

**Required:** add the provider on **Identity → Sync**. The namespaced row
replicates the identity log and both vaults.

### Migrate per-vault onboarding

Existing data is migrated without moving remote files.

- **Per-vault join events:** an installation that can open the identity's
  vaults writes the identity genesis from their signed rosters. The
  [migration rules](../../../nook-event-log/.cortex/docs/architecture/identity-control-log.md#migrate-per-vault-membership-once)
  own which devices become members.
- **Per-vault provider rows:** missing `layout` decodes as the legacy vault
  root. Each row bound to a vault becomes a `legacy-single-vault` mount record.
- **Rollback projection:** schema-1 rollback rows omit identity namespaced rows,
  because an older build would route them to the legacy root.

**Prohibited:** copy a legacy vault's remote events into
`nook-log/v1/vaults/{store_id}/events` during migration.

**Required:** keep them at the legacy root and record the row's layout. Remote
history stays where every existing replica already reads it.

## Browser extension boundary

The extension is another installation with its own `app_id` and app key.
It is not itself an identity.
It acts through a selected identity after the matching app key is enrolled.

## Invariants

- A vault cannot exist without at least one authorizing identity.
- A vault cannot hold a DEK by itself.
- Identity owns per-vault DEKs and member envelopes.
- Passkey protects app key; app key is a member of identity.
- `app_id` names an installation app key, not a person and not a vault.
- No provider credential grants identity membership or vault decryption.
- Portable identity, app-key, DEK, and vault policy belongs in Rust.
  Svelte renders typed state and coordinates browser ceremonies.

## Related records

- [devices-and-access.md](../../../../.cortex/docs/spec/devices-and-access.md)
- [auth-providers.md](auth-providers.md)
- [vault-event-log.md](../../../nook-event-log/.cortex/docs/architecture/vault-event-log.md)
- [identity-control-log.md](../../../nook-event-log/.cortex/docs/architecture/identity-control-log.md)
- [vault-session-and-lock.md](vault-session-and-lock.md)
- [browser-extension.md](../../../../nook-web/nook-web-extension/.cortex/docs/spec/browser-extension.md)
