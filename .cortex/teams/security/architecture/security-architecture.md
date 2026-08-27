# Nook Security Architecture

## Purpose and evidence boundary

This document explains the implemented internal security model of Nook.

It summarizes current repository evidence. It is not a claim of formal
verification, an external audit, regulatory compliance, or immunity from
vulnerabilities.

Use the linked design authorities for detailed storage and lifecycle rules.
Use [Cryptography and protected material](../references/cryptography.md) for
algorithm-to-purpose mappings and source anchors.

## Security objectives

Nook's implemented architecture aims to preserve these properties:

- Secret plaintext is encrypted before durable vault storage or replication.
- Vault decryption keys remain separate from encrypted provider data.
- Each authorized app has distinct encryption and event-signing identities.
- Signed event history determines authorization and rejects unauthorized or
  structurally invalid events.
- Lock clears the active vault session without deleting persisted ciphertext.
- Browser origins and extension contexts remain distinct security boundaries.
- Recovery and joining grant access through explicit cryptographic material,
  not through provider credentials.

These properties depend on correct browser, device, dependency, build, and
deployment behavior. Encryption at rest does not remove those dependencies.

## Protected assets

- **Secret plaintext**
  - Includes passwords, secure notes, cards, authenticator seeds, files, and
    provider credentials while opened.
  - Exists in an unlocked Rust/WASM session and in page-scoped presentation
    only when required by a user action.
- **Vault keys**
  - `secrets_key` encrypts secret values.
  - `members_key` protects membership catalog material.
  - Identity-owned envelopes distribute current keys to authorized apps.
- **App encryption identity**
  - Uses an age X25519 identity for recipient-key envelopes.
  - The private identity is passkey-derived, passkey-wrapped, or PIN-wrapped
    according to the stored protection record.
- **Event-signing identity**
  - Uses a separate Ed25519 seed and public key.
  - It signs canonical event bodies and identifies authorized actors.
- **Recovery material**
  - Includes password envelopes, SLIP-0039 shares, Sentinel shares, and
    enrollment grants.
  - Each recovery path has its own format and acceptance rules.
- **Provider credentials**
  - Replication credentials are sealed locally.
  - They authorize storage transport. They do not prove identity membership or
    grant vault decryption by themselves.

## Trust boundaries

### Rust and WebAssembly boundary

Portable validation, cryptography, authorization, vault storage policy, and
key handling live in Rust. Web code initiates browser ceremonies and renders
public typed projections.

TypeScript and Svelte must not become alternate authorities for:

- vault-key ownership;
- actor authorization;
- cryptographic record validation;
- security-epoch rotation; or
- protected storage formats.

### Locked and unlocked boundary

Persisted IndexedDB state contains encrypted records, wrapped identities,
public metadata, and replication configuration. Unlock reconstructs an
in-memory vault session from accepted key material.

Lock clears the active session and plaintext projection. It does not erase the
encrypted vault, provider mounts, or every public identifier. See
[Vault session and lock](vault-session-and-lock.md).

### Browser origin boundary

The public site, Simple Vault, Sentinel Vault, and browser extension execute in
separate origins or extension contexts. They do not share an unlocked session,
IndexedDB namespace, or WebAuthn relying-party identity merely because they
belong to the same product.

Cross-origin or extension handoff uses explicit, bounded protocols. The
extension identity handoff is recipient-encrypted and binds the nonce, app
encryption public key, app signing public key, and app identifier before
acceptance.

### Replication-provider boundary

Providers store and transport encrypted event-log state. Provider credentials
are independent from vault authorization.

A provider that can read or replace stored blobs does not automatically hold
vault keys. Imported events still pass content, signature, causal, actor, and
security-epoch validation before they influence the materialized state.

### Device and authenticator boundary

WebAuthn ceremonies run in the browser and platform authenticator. Rust/WASM
accepts the bounded PRF result and credential metadata needed for the selected
protection mode.

Nook does not treat browser-reported attachment, transport, or backup metadata
as cryptographic proof. Successful app-key recovery or vault opening provides
the stronger local evidence.

## Key hierarchy and separation

1. An app owns an age X25519 encryption identity and a separate Ed25519 event
   signer.
2. An identity owns vault key envelopes for authorized apps.
3. A vault uses separate `secrets_key` and `members_key` values.
4. Secret records are encrypted under vault key material.
5. Membership changes and security triggers update authorization history and
   may rotate the security epoch.

The following values are intentionally not interchangeable:

- provider credential and app identity;
- app encryption key and event-signing key;
- identity and vault;
- vault identifier and vault key;
- public device metadata and verified key possession; and
- encrypted replica and trusted materialized state.

See [Identity, app keys, passkeys, and vault keys](identity-vault-architecture.md)
for the full ownership model.

## Encryption and integrity layers

- **Secret-value encryption**
  - Uses age scrypt recipients with a uniformly random vault key as input.
  - New records use the repository's programmatic work factor because the
    input is random key material, not a human password.
- **Per-app key distribution**
  - Uses age X25519 recipient envelopes.
- **Local app-key protection**
  - Passkey-derived mode uses WebAuthn PRF output and HKDF-SHA256.
  - Passkey-wrapped and PIN fallback records use AES-256-GCM with bound
    metadata as additional authenticated data.
  - PIN fallback derives its wrapping key with PBKDF2-SHA256 and the persisted
    iteration count.
- **Password unlock**
  - Uses age scrypt password protection for a wrapping identity.
  - That identity opens an age X25519 envelope containing the vault keys.
- **Event authenticity**
  - Uses Ed25519 signatures over canonical event bodies.
  - Uses SHA-256-derived identifiers for content and actors.
- **Keyed metadata integrity**
  - Uses HMAC-SHA256 for keyed secret fingerprints and the search catalog.

Exact versions, work factors, domain-separation contexts, and source anchors
are listed in [Cryptography and protected material](../references/cryptography.md).

## Authorization and event history

The encrypted event log is also the authorization history.

- Each non-genesis event is signed.
- Actor identity derives from the validated Ed25519 public key.
- Causal ancestry determines which actors were authorized before an event.
- Device revocation removes the corresponding actor from subsequent accepted
  history.
- Unauthorized actors and descendants of rejected events are quarantined.
- Security-epoch checkpoints must have the required schema, parent, trigger,
  and operation shape.
- Self-signed membership is limited to explicit join cases. Sentinel
  enrollment requires an already authorized actor.

The canonical event and epoch details remain in the development-core
[Vault event log](../../dev-core/design-docs/vault-event-log.md).

## Recovery and access paths

Nook has several implemented access paths. They do not collapse into one
generic recovery credential.

- Passkey protection derives or unwraps an app encryption identity.
- PIN fallback unwraps a locally stored app identity.
- Password unlock opens a password-specific vault-key envelope.
- SLIP-0039 recovers encoded protected material from a threshold of mnemonic
  shares.
- Sentinel recovery reconstructs protected material from authorized encrypted
  shares and signed participant responses.
- Device join grants current vault key envelopes to an approved app.

Product behavior and user flows remain in the owning development-core specs.
Security documentation records the shared invariants and mechanisms.

## Operational and supply-chain controls

SRE owns CI, dependency policy, release, deployment, and runtime controls.
Current repository gates include dependency-policy and RustSec checks,
repository lints, Rust ecosystem checks, WASM and web verification, browser
boundary checks, and exact-head deployment verification.

Those gates reduce risk. They do not replace security review of changed trust
boundaries, cryptographic formats, authorization logic, or secret handling.

## Security change rules

A change requires security-team review when it modifies one or more of these:

- cryptographic algorithm, parameter, domain-separation value, or record
  version;
- key generation, derivation, wrapping, rotation, recovery, or destruction;
- authorization, membership, revocation, event signing, or quarantine;
- plaintext lifetime, logging, serialization, persistence, or transport;
- browser origin, extension permission, content-script, CSP, or handoff
  boundary; or
- provider credential sealing or replica acceptance.

The implementation stays with its functional team unless the delivery owner
assigns a bounded security expertise unit.

## Known limitations of this document

- It inventories implemented repository behavior, not every platform threat.
- It does not assert resistance to a compromised browser, operating system,
  dependency, build worker, or authorized endpoint.
- It does not define an external disclosure or incident-response program.
- It does not claim formal cryptographic review.
- Import compatibility code may use algorithms required to decrypt third-party
  export formats. Those algorithms are not automatically Nook storage choices.
