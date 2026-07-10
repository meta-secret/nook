# Nexus Genesis and Reverse Onboarding

**Status:** Accepted target design; current implementation requires migration.

This document defines how a new Nexus vault comes into existence. Nexus genesis
is not ordinary vault creation followed by device onboarding. It is a
pre-vault, multi-device key ceremony that must complete before an openable vault
or an unlocked vault session exists.

Related:
[vault-architecture-modes.md](vault-architecture-modes.md),
[vault-session-and-lock.md](vault-session-and-lock.md),
[vault-event-log.md](vault-event-log.md), and
[slip39-recovery.md](../product-specs/slip39-recovery.md).

## Core Decision

Vault creation asks for the vault type only:

- **Simple:** create an empty local vault in memory. The device can open it
  immediately with its normal device-key envelope. Sync providers are optional
  backups/replicas configured after creation.
- **Nexus:** start a reverse-onboarding ceremony. Do not create an openable
  vault, generate a usable vault session, or configure a sync provider yet.

`replication_type` is not a vault architecture choice and must not appear in
vault creation. A sync provider transports encrypted vault data after genesis;
it neither defines Nexus membership nor contributes to the unlock threshold.

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

1. Device A starts Nexus setup and chooses `N` and `T`.
2. WASM creates a typed genesis session identifier and a public request
   QR/link/paste payload. This is a pairing request, not a vault onboarding
   link.
3. Device B scans the request after completing its own device initialization.
4. Device B displays a signed response QR containing its participant identity,
   public encryption key, public signing key, session binding, and a human
   verification fingerprint.
5. Device A scans the response, verifies it in Rust/WASM, rejects duplicates,
   and adds the participant to the pending roster.
6. Repeat until all configured `N` participant public keys are present,
   including Device A's own public keys.

The pending roster is pre-genesis ceremony state. It is not a vault member
roster, has no `store_id`, creates no vault event, and cannot be opened as a
vault. Whether an unfinished ceremony survives refresh is a separate product
decision; any persisted draft must contain public data only and must never be
mistaken for a vault.

### Atomic key generation

After all participant keys are verified:

1. Rust generates the Nexus root/DEK and derives the vault's explicit
   `secrets_key` and `members_key` material.
2. Rust splits the Nexus root with SLIP-0039 using the selected `T-of-N`
   policy.
3. Each member share is encrypted to exactly one participant's public
   encryption key.
4. Rust constructs the complete participant roster, share commitments, and
   encrypted share set.
5. Only after every encrypted share is valid does Nook atomically create the
   empty vault, assign its `store_id`, and write genesis state.

There is no persistable partial-share vault. Failure before the atomic step
leaves no openable Nexus vault. Device A is not a privileged permanent owner and
must not receive a full-key envelope that bypasses the threshold.

### Round 2: return encrypted shares

Without a sync provider, Device A returns each participant's encrypted member
share through a response QR/link/paste payload. Each participant can decrypt
and protect only its own share. This second direction is cryptographically
required: collecting public keys alone does not deliver the newly generated
shares back to their owners.

A provider configured later may transport the public roster and encrypted share
records as part of normal encrypted vault replication, but provider access is
not required to complete the genesis key ceremony and is never sufficient to
open the vault.

After delivering the share set, Device A clears the plaintext Nexus root,
derived vault keys, and plaintext shares. Opening the newly created vault then
uses the same quorum ceremony as every later open; genesis must not leave a
single-device unlocked-session exception.

## Nexus Open Invariant

A Nexus vault is not openable when fewer than `T` distinct valid participant
contributions are available. This applies immediately after genesis, on reload,
after import, and on every device.

```text
device authorization
  -> open this device's protected Nexus share
  -> produce a session-bound contribution
  -> collect at least T distinct contributions
  -> reconstruct Nexus root inside Rust/WASM
  -> derive/open vault keys
  -> create unlocked vault session
```

No password, sync-provider login, local cache, initiator role, or possession of
the encrypted vault can replace the quorum.

## Sync and Import

Sync is a post-genesis backup/replication concern for both vault types:

- **Simple import:** fetch the encrypted vault, then use an enrolled device key
  or supported simple-vault recovery/enrollment path.
- **Nexus import:** fetch the encrypted vault and roster/share ciphertext, then
  require an enrolled participant share plus a valid quorum ceremony. Provider
  credentials alone grant storage access, not Nexus access.

Import and creation are separate top-level workflows. Import detects the vault
type from validated metadata and routes to the matching access ceremony. Nexus
genesis itself does not require a provider.

## Relationship to SLIP-0039 Recovery

Nexus genesis and device-quorum recovery may reuse the same audited SLIP-0039
primitive, but they are different protocols:

- Nexus genesis creates the vault's threshold access root and configurable
  `T-of-N` participant shares before the vault exists.
- The recovery spec defines a fixed recovery policy for an already existing
  vault and its own request/response/session bindings.

Do not reuse recovery QR payloads, recovery identifiers, or fixed 2-of-3 policy
as Nexus-genesis payloads. Both protocols need separate typed records and domain
tests.

## Required Migration From Current Implementation

The current milestone implementation creates Nexus key material too early,
persists a replication mode on vault architecture, and gates secret creation
rather than vault existence/opening. The target migration must:

1. remove replication selection from vault creation;
2. model Nexus setup as pre-genesis typed state;
3. collect and verify the complete participant public-key roster first;
4. atomically generate and distribute SLIP-0039 encrypted shares;
5. forbid creation of a full-key device envelope for Nexus;
6. forbid every Nexus open path until quorum succeeds;
7. configure sync providers only after genesis;
8. update persistence, event authorization, WASM APIs, UI, and tests together.

