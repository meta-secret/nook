# Sentinel Genesis and Reverse Onboarding

**Status:** Implemented across `nook-auth2`, `nook-core`, `nook-wasm`, and the
vault-creation UI.

This document defines how a new Sentinel vault comes into existence. Sentinel genesis
is not ordinary vault creation followed by device onboarding. It is a
pre-vault, multi-device key ceremony that must complete before an openable vault
or an unlocked vault session exists.

Related:
[vault-architecture-modes.md](vault-architecture-modes.md),
[vault-session-and-lock.md](vault-session-and-lock.md),
[vault-event-log.md](vault-event-log.md), and
[slip39-recovery.md](../product-specs/slip39-recovery.md).

## Core Decision

Get started (empty device) presents exactly two owner creation paths:

- **Create Simple:** create an empty local vault in memory after passkey
  confirmation at the create step. The device can open it immediately with its
  normal device-key envelope. Sync providers are optional backups/replicas
  configured after creation.
- **Create Sentinel:** start a reverse-onboarding ceremony. Do not create an
  openable vault, generate a usable vault session, or configure a sync provider
  before atomic genesis. The initiator chooses `N`/`T`, waits for every
  participant public key, atomically creates the empty vault, then selects one
  sync provider and issues one addressed onboarding QR/link per remote member.

There is no unrestricted **Join Sentinel** choice on the creation landing page.
The initiating owner onboards participants from the Sentinel workspace; a
participant never starts genesis independently. The current wire format accepts
signed public-key announcements, while cryptographically binding every remote
response to an owner-issued QR/link request is tracked in
[#337](https://github.com/meta-secret/nook/issues/337).
After genesis, the owner must connect a sync provider before member invitations
are emitted. Each invitation combines that participant's signed encrypted share
with a provider snapshot whose credentials are age-encrypted to the same
participant device public key. Simple-vault password enrollment is not reused.

When a local vault already exists, the passkey/device-protection gate runs
**before** unlock. Product and persisted wire names use Sentinel consistently.

`replication_type` is not a vault architecture choice and must not appear in
vault creation. A sync provider transports encrypted vault data after genesis;
it neither defines Sentinel membership nor contributes to the unlock threshold.

## Policy Selection

The initiator chooses before collecting participants:

- participant count `N`;
- unlock threshold `T`, where `2 <= T <= N`.

The participant count says how many encrypted member shares genesis will issue.
The threshold says how many distinct participant contributions are required to
open the vault. Genesis waits for all configured `N` participant public keys;
collecting only `T` keys is insufficient to issue an `N`-member share set.

Policy validation and state transitions belong to `nook-auth2` / `nook-core`.
Svelte renders typed ceremony state and must not implement threshold rules.

## Reverse-Onboarding Ceremony

Each participant first initializes its own protected Nook device identity. No
participant sends a private key, device secret, passkey output, provider token,
or vault key to another device.

### Round 1: collect participant public keys

1. Device A names an in-memory Sentinel genesis draft, then chooses `N` and `T`.
2. Each participant device independently creates a signed public-key
   announcement after completing its own device initialization. The announcement
   contains its participant identity, public encryption key, public signing key,
   label, signature, and a human-verification fingerprint.
3. Device A initiates the onboarding exchange and the participant returns the
   announcement through QR, link, or paste; participant setup is never entered
   as a free-standing landing-page choice.
4. Device A imports the announcement into the active genesis session, verifies
   it in Rust/WASM, rejects duplicates, and adds the participant to the pending
   roster.
5. Repeat until all configured `N` participant public keys are present,
   including Device A's own public keys.

The Card Stack add-participant action remains available during this pre-genesis
stage. If Device A has no protected identity yet, adding the first signed
announcement opens device passkey setup, creates Device A's keys, starts the
public-only roster session, and then verifies the queued announcement. The user
must not have to create a vault or start a request-bound flow before the `+`
action can collect standalone participant keys.

The pending roster is pre-genesis ceremony state. It is not a vault member
roster, has no `store_id`, creates no vault event, and cannot be opened as a
vault. The Rust session contains public ceremony data only. Verified participant
responses remain session state and are never interpreted as persisted vault
membership before finalization.

### Atomic key generation

After all participant keys are verified:

1. Rust generates one random 32-byte Sentinel root and derives the vault's explicit
   `secrets_key` and `members_key` through domain-separated HKDF-SHA256.
2. Rust splits the Sentinel root with current-format, extendable (`ext=1`),
   single-group SLIP-0039 using the selected `T-of-N` policy. The implementation
   is Nook-owned and covered by the official 256-bit extendable vectors.
3. Each member share is encrypted to exactly one participant's public
   encryption key.
4. Rust constructs the complete participant roster, share commitments, and
   encrypted share set.
5. Only after every encrypted share is valid does Nook atomically create the
   empty vault, assign its `store_id`, and write genesis state.

There is no persistable partial-share vault. Failure before the atomic step
leaves no openable Sentinel vault. Device A is not a privileged permanent owner and
must not receive a full-key envelope that bypasses the threshold.

Finalization consumes the in-memory genesis session and produces one complete
result: `store_id`, immutable Sentinel policy, encrypted member rows, encrypted
share rows, public participant roster, event-log genesis operations, and the
participant delivery catalog. Persistence treats that result as one unit.
Delivery entries are addressed by `store_id` and participant `device_id`, so a
retry reads or re-delivers the same encrypted artifact instead of issuing a new
share generation. Finalization itself is one-shot; callers must never rerun key
generation to repair a partially persisted result.

### Round 2: connect storage and invite members

After atomic genesis, Device A chooses one remote sync provider and uploads the
encrypted vault. Local-folder storage cannot serve member onboarding because a
browser folder handle is not transferable. Nook then creates a distinct QR/link
for every remote participant. The package contains the Round 1 request, that
participant's signed encrypted share delivery, and one provider snapshot
encrypted to the participant public key collected in Round 1.

Delivery acceptance verifies the genesis session, policy, initiator signing
key, participant identity, public key, and share signature. Only the matching
device can decrypt the provider snapshot and its share. It persists both, pulls
the encrypted vault from the provider, and enters the normal Sentinel quorum
unlock ceremony. Provider access is necessary for this onboarding transport but
is never sufficient to open the vault.

This second direction is cryptographically required: collecting public keys
alone does not deliver the generated shares or encrypted vault replica back to
their owners.

After delivering the share set, Device A clears the plaintext Sentinel root,
derived vault keys, and plaintext shares. Opening the newly created vault then
uses the same quorum ceremony as every later open; genesis must not leave a
single-device unlocked-session exception.

## Sentinel Open Invariant

A Sentinel vault is not openable when fewer than `T` distinct valid participant
contributions are available. This applies immediately after genesis, on reload,
after import, and on every device.

```text
device authorization
  -> open this device's protected Sentinel share
  -> produce a session-bound contribution
  -> collect at least T distinct contributions
  -> reconstruct Sentinel root inside Rust/WASM
  -> derive/open vault keys
  -> create unlocked vault session
```

The implemented unlock exchange is also typed and session-bound. The requester
creates a signed request containing its ephemeral session, store, Sentinel policy,
device encryption key, and signing key. A participant authorizes its protected
device identity, opens only its local encrypted SLIP-0039 share inside Rust,
encrypts an opaque contribution to the requester, and signs the response.
Responses are rejected for the wrong session, store, policy, requester,
participant, or share index and for duplicate participants/indexes. Only after
`T` valid responses does Rust decrypt the transient contributions, reconstruct
the root, derive the two vault keys, and return an unlocked session result.

SLIP-0039 mnemonic text never crosses the Rust/WASM boundary, is never stored in
the browser ceremony session, and is never exposed in a QR payload or Svelte
state. The serializable request/response boundary carries signed metadata and
age-encrypted ciphertext only.

No password, sync-provider login, local cache, initiator role, or possession of
the encrypted vault can replace the quorum.

## Event Log and Roster Materialization

Atomic Sentinel genesis emits one participant-enrollment operation for every
verified participant plus one complete share-issuance operation. Event-only
replay retains the public participant roster, including encryption key, signing
key, label, and enrollment time, before quorum access is available. Rename and
revocation operations update that public projection. After quorum reconstructs
`members_key`, Rust rebuilds the canonical encrypted `members:` rows from the
retained roster; event replay therefore never silently discards Sentinel members.

## Sync and Import

Sync is a post-genesis backup/replication concern for both vault types:

- **Simple import:** fetch the encrypted vault, then use an enrolled device key
  or supported simple-vault recovery/enrollment path.
- **Sentinel import:** fetch the encrypted vault and roster/share ciphertext, then
  require an enrolled participant share plus a valid quorum ceremony. Provider
  credentials alone grant storage access, not Sentinel access.

Import and creation are separate top-level workflows. Import detects the vault
type from validated metadata and routes to the matching access ceremony. Sentinel
genesis itself does not require a provider.

## Relationship to SLIP-0039 Recovery

Sentinel genesis and device-quorum recovery may reuse the same audited SLIP-0039
primitive, but they are different protocols:

- Sentinel genesis creates the vault's threshold access root and configurable
  `T-of-N` participant shares before the vault exists.
- The recovery spec defines a fixed recovery policy for an already existing
  vault and its own request/response/session bindings.

Do not reuse recovery QR payloads, recovery identifiers, or fixed 2-of-3 policy
as Sentinel-genesis payloads. Both protocols need separate typed records and domain
tests.

## Compatibility

Legacy version-1 Sentinel share records remain readable. New genesis writes the
version-2 root-based format described here. Legacy `replication_type` metadata
also remains readable, but default personal replication is omitted from new
architecture serialization and never participates in Sentinel policy, genesis,
delivery, or unlock decisions.
