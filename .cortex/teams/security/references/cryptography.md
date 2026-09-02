# Cryptography and Protected Material

## Purpose

This reference maps implemented cryptographic mechanisms to their exact Nook
purpose and source evidence.

It is an inventory, not an algorithm recommendation or audit report. A crate in
a manifest is not evidence that every feature uses that crate.

## Primary mechanisms

- **age X25519 recipient encryption**
  - **Implemented purpose:** Per-app vault-key envelopes, enrollment material, and extension identity handoff
  - **Primary evidence:** `nook-app/nook-platform/nook-auth2/src/auth/multi_device/`, `nook-app/nook-platform/nook-core/src/auth/extension_identity_handoff.rs`
- **age scrypt encryption**
  - **Implemented purpose:** Vault secret records keyed by random vault material; password-protected wrapping identities
  - **Primary evidence:** `nook-app/nook-platform/nook-auth2/src/crypto/vault_crypto.rs`, `nook-app/nook-platform/nook-auth2/src/auth/password_envelope.rs`
- **AES-256-GCM**
  - **Implemented purpose:** Passkey-wrapped and PIN-wrapped local app encryption identities
  - **Primary evidence:** `nook-app/nook-platform/nook-auth2/src/auth/device_key_protection/protected_identity.rs`
- **HKDF-SHA256**
  - **Implemented purpose:** Passkey PRF to app identity or app-identity wrapping key; Sentinel derivation contexts
  - **Primary evidence:** `nook-app/nook-platform/nook-auth2/src/auth/device_key_protection.rs`, `nook-app/nook-platform/nook-auth2/src/auth/multi_device/sentinel.rs`
- **PBKDF2-SHA256**
  - **Implemented purpose:** PIN fallback wrapping key
  - **Primary evidence:** `nook-app/nook-platform/nook-auth2/src/auth/device_key_protection/protected_identity.rs`
- **Ed25519**
  - **Implemented purpose:** Event signatures and actor identity
  - **Primary evidence:** `nook-app/nook-platform/nook-event-log/src/signing.rs`, `nook-app/nook-platform/nook-event-log/src/event.rs`
- **SHA-256**
  - **Implemented purpose:** Content IDs, actor IDs, public-key-derived identifiers, and bounded digests
  - **Primary evidence:**
    - `nook-app/nook-platform/nook-event-log/src/event.rs`
    - `nook-app/nook-platform/nook-event-log/src/signing.rs`
    - `nook-app/nook-platform/nook-auth2/src/auth/multi_device/state.rs`
- **HMAC-SHA256**
  - **Implemented purpose:** Vault-keyed secret fingerprints, search-catalog integrity, and SLIP-0039 share digest support
  - **Primary evidence:**
    - `nook-app/nook-platform/nook-core/src/secrets/secret_fingerprint.rs`
    - `nook-app/nook-platform/nook-core/src/vault/vault_search_catalog.rs`
    - `nook-app/nook-platform/nook-auth2/src/auth/slip39.rs`
- **SLIP-0039 threshold sharing**
  - **Implemented purpose:** Mnemonic recovery shares for protected material
  - **Primary evidence:** `nook-app/nook-platform/nook-auth2/src/auth/slip39.rs`

## Current protection parameters

- **PIN-wrapped app identity**
  - Record version: `2`.
  - KDF: PBKDF2-SHA256.
  - New-record iteration count: `600,000`.
  - Salt: 32 random bytes.
  - Cipher: AES-256-GCM.
  - Nonce: 12 random bytes.
  - Additional authenticated data binds the record context and parameters.
- **Passkey-derived app identity**
  - Record version: `3`.
  - Input: 32-byte WebAuthn PRF output and bounded user handle.
  - KDF: HKDF-SHA256 with a versioned domain-separation context.
- **Passkey-wrapped local app identity**
  - Record version: `4`.
  - KDF: HKDF-SHA256 with a random 32-byte salt.
  - Cipher: AES-256-GCM with a 12-byte random nonce.
  - Additional authenticated data binds versioned record metadata.
- **Password unlock envelope**
  - Current record version: `2`.
  - KDF field: `scrypt`.
  - New human-password work factor: `log_n = 18`.
  - The password-protected value is a generated age X25519 wrapping identity.
  - That identity opens the separate vault-key envelope.
- **Vault secret encryption**
  - Uses age scrypt with a uniformly random 256-bit vault key.
  - New-record programmatic work factor: `log_n = 10`.
  - Existing records retain their embedded work factor.

Tests may inject smaller work factors for bounded browser execution. Those test
parameters are not the production defaults.

## Key ownership

- `secrets_key`
  - Symmetric vault key for secret-value encryption.
  - Also keys privacy-preserving secret fingerprints.
- `members_key`
  - Symmetric vault key for protected membership catalog entries.
- App age X25519 identity
  - Opens app-addressed vault-key and handoff envelopes.
  - Private material is protected by passkey or PIN mode.
- App Ed25519 signing identity
  - Signs canonical event bodies.
  - Must remain distinct from the age encryption identity.
- Provider credential key material
  - Seals replication credentials locally.
  - Does not become a vault key or membership proof.

## Record validation and secret handling

Implemented crypto records validate version, declared algorithm names, lengths,
work factors, and bound metadata before opening protected material.

Sensitive Rust wrappers redact debug output or zeroize owned buffers where the
implementation provides those wrappers. This reduces accidental exposure. It
does not prove that every browser, platform, allocator, or third-party library
copy is erased immediately.

Logs and errors must not include:

- secret plaintext;
- private app identities;
- event-signing seeds;
- WebAuthn PRF output;
- PINs or passwords;
- vault keys; or
- unsealed provider credentials.

## Import-only cryptography

Third-party import code supports the algorithms required by those export
formats. For example, encrypted Bitwarden import handles PBKDF2 or Argon2id
derivation and validates authenticated ciphertext before conversion.

Import support does not make those algorithms Nook's native vault format.

## Change discipline

When changing a mechanism or parameter:

1. Identify every persisted version and backward-compatible reader.
2. Preserve fail-closed validation for unsupported parameters.
3. Add behavior-focused Rust tests for successful and rejected records.
4. Add WASM or browser evidence only for the changed boundary.
5. Update this reference and the owning detailed architecture.
6. Route implementation through the functional team and security acceptance
   through the security team.
