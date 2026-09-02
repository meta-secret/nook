# Vault Architecture Modes

## Overview

**Status:** Vault modes and the device-local identity directory are implemented.
Replicated identity control and cross-installation enrollment remain target
architecture.

Nook's security choices belong to their owning lifecycle. Rust owns policy in
`nook-core` / `nook-auth2`; WASM exposes typed decisions to the web layer.
Vault creation chooses only the vault key-access model. Replication is a
post-creation storage concern, not a vault mode.

In the target identity architecture, identity creation and device onboarding
are separate from vault creation. A combined product journey may perform them
consecutively, but a person may hold multiple virtual identities; each exists
independently with zero or more registered keys and receives explicit grants
to independently encrypted vaults. Local identity selection and identity-owned
DEK records are implemented. Replicated identity-control storage,
cross-installation enrollment, and revocation remain target architecture. See
[identity-vault-architecture.md](../../security/architecture/identity-vault-architecture.md).

## Architecture Groups

- **`device_mode`**
  - **Values:** `standard`, `anti-hacker`
  - **Owner:** `nook-auth2` / `nook-core`
  - **Notes:** Existing protection modes. `standard` deterministically derives the current age identity from passkey PRF and is a compatibility boundary; the target model always wraps a fresh installation-specific device key. The UI calls the latter High security.
- **`vault_type`**
  - **Values:** `simple`, `sentinel`
  - **Owner:** `nook-core`
  - **Notes:** Vault key-access lifecycle. This is the only vault-type choice during creation.
- **Sentinel policy**
  - **Values:** participant count `N`, threshold `T`
  - **Owner:** `nook-auth2` / `nook-core`
  - **Notes:** Chosen only for Sentinel genesis before vault keys exist.
- **Replication provider**
  - **Values:** provider-specific connection/mount
  - **Owner:** `nook-replication` / `nook-core` / `nook-wasm`
  - **Notes:** Neutral encrypted transport usable by identity control logs and vault event logs. Not a vault mode, identity, or unlock factor.

`replication_type` and its derived `onboarding_type` are legacy implementation
concepts. Provider account ownership or sharing capability belongs to an
individual provider connection; it does not alter the vault's cryptographic
access model.

## Creation and Import UX

Creation and import are separate top-level workflows. Empty-device get started
uses the **Landing → Sentinel** handoff: **name the vault first**, then choose
exactly one of Simple create or Sentinel create. Participants join only through
an owner-issued invitation URL. Sync-provider import remains a secondary
“already have a vault” action, not a third create intent.

- **Landing handoff (empty device)**
  - **Choice or state:** Vault name
  - **Transition:** Collect the vault name before path choice. Passkey is **not** required yet. **Exception:** an `#enroll=` deep link skips create landing and opens Finish device onboarding (passkey + vault password).
- **Path chooser**
  - **Choice or state:** Path
  - **Transition:** Choose exactly one: Create Simple or Create Sentinel. There is no unrestricted Join path.
- **Create Simple confirm**
  - **Choice or state:** Create action
  - **Transition:** Confirm local create; **then** show the passkey/device-protection form (top-right overlay) before sealing the vault.
- **Existing vault unlock**
  - **Choice or state:** Device protection
  - **Transition:** Passkey/PIN gate runs **first** when a local vault already exists on this browser.
- **Create Sentinel**
  - **Choice or state:** Name (carried), then Sentinel policy
  - **Transition:** Choose participant count `N` and unlock threshold `T`; do not create/open a vault yet.
- **Create Sentinel waiting**
  - **Choice or state:** Participant responses
  - **Transition:** Gather session-bound responses to the owner-issued invitation through QR/link/paste. Standalone public-key announcements are rejected.
- **Sentinel atomic genesis**
  - **Choice or state:** Encrypted shares
  - **Transition:** Generate the Sentinel root/DEK only after the roster is complete, split it with SLIP-0039, encrypt one share per participant, then create the empty vault atomically.
- **Owner invitation / participant response**
  - **Choice or state:** Invitation-bound join
  - **Transition:** Participant opens the owner invitation URL, authorizes this device, and returns a signed session-bound response. Share delivery is a secondary post-genesis step.
- **Sentinel open**
  - **Choice or state:** Quorum contributions
  - **Transition:** Do not open the vault unless at least `T` distinct participant contributions reconstruct the root in Rust/WASM.
- **Import**
  - **Choice or state:** Detected vault type
  - **Transition:** Fetch from a provider, then route Simple to its unlock/enrollment path or Sentinel to quorum access. Provider login never opens Sentinel.
- **Unlocked provider management / Onboard**
  - **Choice or state:** Sync provider
  - **Transition:** Add/remove post-genesis backup replicas, or onboard another browser with the standard password + sync QR after the vault exists.

See [sentinel-genesis.md](sentinel-genesis.md) for the complete two-round ceremony and
security invariants. Product and persisted wire names use **Sentinel** consistently.

## Defaults and Persistence

The default architecture is:

```yaml
architecture:
  device_mode: standard
  vault_type: simple
```

The default may be omitted on write to keep Simple vault YAML compact.
Non-default vault architecture metadata is persisted as a top-level
`architecture:` field in projection YAML and mirrored through WASM session
state. Vault type is immutable once a vault has a `store_id`; changing Simple
to Sentinel or Sentinel to Simple would reinterpret key-access records and must fail.

`replication_type` values do not define new-vault
behavior. Default personal replication is omitted from new architecture
serialization, and vault creation does not ask for a replication mode.

Device-local High security material never belongs in vault YAML, provider
snapshots, event logs, app logs, or onboarding payloads. The local record is the
`passkey-wrapped-local` `device_identity_wrapped` IndexedDB value.

## Simple Lifecycle

Simple creation generates an empty vault locally and creates the normal
device-key envelope for the initiating device. The vault is immediately
openable on that device. Sync providers are optional and can be connected later
as backup/replica targets.

Importing a Simple vault retrieves encrypted data first, then uses an existing
device envelope, password recovery, or explicit enrollment path. Provider
credentials grant storage access only.

## Sentinel Lifecycle

- **Pre-genesis setup:**
  - Gather every configured participant public key before generating the
    Sentinel root or creating the vault.
  - Issue the complete encrypted SLIP-0039 share set atomically during genesis.
  - Give the initiator no permanent threshold bypass.
  - Never write a per-device full-key envelope.
- **Unlock boundary:**
  - Forbid password unlock as the sole unlock path.
  - Fail closed during session hydrate from projection YAML.
  - Never resolve a full-key auth envelope.
  - Treat possession of the local cache or sync-provider credentials as
    insufficient.
- **Share-set validity:**
  - Require a complete set with unique participant and share indexes.
  - Require the set to match the persisted `T-of-N` policy.
  - Fail closed on partial, malformed-prefix, stale-generation, or mixed sets.
  - Create no Sentinel vault session until share records exist and at least `T`
    participant contributions reconstruct the root.
  - Do not treat secret-creation gating alone as sufficient.
- **Post-genesis browser unlock:**
  1. Each participating device opens its protected local share inside Rust.
  2. It returns a signed, session-bound opaque contribution encrypted to the
     requester.
  3. The requester combines at least `T` distinct verified contributions inside
     Rust/WASM.
  - Peer `DeviceIdentity` secrets and plaintext shares never cross browsers.
  - Raw SLIP-0039 mnemonics never cross the WASM boundary.
- **Cryptographic format:**
  - Use Nook's current-format extendable (`ext=1`), single-group SLIP-0039
    implementation with the user-selected `T-of-N` policy.
  - Derive `secrets_key` and `members_key` from one random 32-byte Sentinel root
    through domain-separated HKDF-SHA256.
  - Cover the codec with official extendable 256-bit vectors.
  - Keep this separate from the fixed-policy recovery flow in
    [slip39-recovery.md](../product-specs/slip39-recovery.md).
- **Participant replacement:** Atomically replace the roster and rotate shares.
  Generic revocation or key rotation must not leave the new epoch behind old
  shares or write a full current-device envelope.

## Provider Capabilities

- Provider capability affects only storage setup and transport.
  - Examples include app-private storage, shared-folder grants, and binding a
    connection to an external account identity.
  - Unsupported provider operations fail closed in Rust.
  - Provider capabilities do not create a `personal` or `shared` vault mode.

- **Google Drive:** The `private` / `shared` choice is independent of vault
  architecture.
  - Private mode uses app-private storage (`drive.appdata`).
  - Shared mode uses a visible folder and this grant flow:

    1. The owner creates a folder and grants the joiner's external identity
       (`drive.file` plus `permissions.create` when the token allows it).
    2. The connection records the folder target without embedding owner tokens.
    3. The joiner uses its own OAuth account to access the same encrypted
       replica.

  - If automatic grant cannot run because the owner token is missing, lacks
    `drive.file`, or encounters a Drive API error, return
    `ManualGrantRequired`.
  - Show localized manual-share instructions and permit binding an
    already-created `folderId`.
  - See [auth-providers.md](auth-providers.md#google-drive-modes).

  - Never use this provider-account flow as Sentinel membership or quorum.

- **Google Drive live coverage:** The smoke test outside Playwright Drive stubs
  is opt-in under
  `nook-web-app/e2e/live/google-drive-shared-grant.smoke.spec.ts`.
  - Require `NOOK_GOOGLE_E2E_ACCESS_TOKEN` and
    `NOOK_GOOGLE_E2E_JOINER_EMAIL`.
  - Use optional `NOOK_GOOGLE_E2E_JOINER_ACCESS_TOKEN` to prove joiner access
    under that folder.

- **iCloud:** Expose the same provider-level private/shared choice through
  CloudKit instead of a directory ACL.
  - The owner creates a custom-zone root share.
  - A participant accepts its stable share identifier with a separate Apple
    sign-in.
  - The persisted provider target carries CloudKit zone/root routing but no
    account credential.
  - Owners route event I/O through the private database.
  - Participants route the same hierarchy through the shared database.

## Web Boundary

Svelte may render vault type, Sentinel policy, ceremony progress, and provider
choices, but it must call Rust/WASM for policy validation, participant
verification, share issuance, quorum access, and provider capability. Do not
recreate the state machine or threshold rules in TypeScript.

## Implemented Boundaries

- Sentinel policy and ceremony transitions are Rust-owned and limited to
  `2 <= T <= N <= 16`.
- Finalization is one-shot and atomic: it emits the complete encrypted member
  roster, encrypted share set, participant delivery catalog, and event-log
  operations together; it never emits a full-key device envelope.
- Provider-free Round 2 delivery entries are signed and bound to the exact
  Round 1 session, store, policy, recipient identity, and share.
- Event-only projection retains the complete public Sentinel roster and rebuilds
  canonical encrypted member rows after quorum unlock.
- Sentinel unlock requests and responses are signed, encrypted, and session-bound;
  duplicate participants/share indexes and mismatched bindings fail closed.
- WASM exposes typed JSON/status boundaries while Svelte renders progress; raw
  roots, vault keys, opened shares, and mnemonic text remain in Rust.
