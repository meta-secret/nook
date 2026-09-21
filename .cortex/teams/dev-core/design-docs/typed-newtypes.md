# Nook Typed Values and Lint Rollout

Generic modeling and construction rules come from Meta-Cortex Rust development.
This document owns the existing Nook value inventory and compiler-lint rollout.

## Inventory

### Implemented (`nook-core`)

**Identifiers and event identity**

- **`CompactToken`**
  - **Module:** `vault_ids`
  - **Wire / meaning:** 11-char base64url random suffix
- **`StoreId`**
  - **Module:** `vault_ids`
  - **Wire / meaning:** `store_{token}` vault identity
- **`SecretId`**
  - **Module:** `vault_ids`
  - **Wire / meaning:** `secret_{token}`
- **`AuthKeyId`**
  - **Module:** `vault_ids`
  - **Wire / meaning:** `key_{sha256_hex}` actor / auth row
- **`DeviceId`**
  - **Module:** `vault_ids`
  - **Wire / meaning:** 16-hex device fingerprint
- **`EventId`**
  - **Module:** `event_canonical`
  - **Wire / meaning:** `sha256u:{base64url_no_pad}` content-addressed event
- **`KeyEpoch`**
  - **Module:** `vault_epoch`
  - **Wire / meaning:** wraps `EventId` — epoch protecting payloads

**Cryptographic and wire values**

- **`Ed25519Signature`**
  - **Module:** `event_canonical`
  - **Wire / meaning:** `ed25519:{hex}` event signature
- **`Sha256Hex`**
  - **Module:** `vault_wire`
  - **Wire / meaning:** bare 64-hex digest (content hash, checkpoint)
- **`DeviceSigningPublicKey`**
  - **Module:** `vault_wire`
  - **Wire / meaning:** 64-hex Ed25519 verifying key bytes
- **`SymmetricKey`**
  - **Module:** `vault_wire`
  - **Wire / meaning:** 64-hex vault symmetric key
- **`DevicePublicKey`**
  - **Module:** `vault_wire`
  - **Wire / meaning:** age X25519 recipient string
- **`DeviceIdentitySecret`**
  - **Module:** `vault_wire`
  - **Wire / meaning:** age X25519 identity secret
- **`AgeArmoredCiphertext`**
  - **Module:** `vault_wire`
  - **Wire / meaning:** age armor block

**Stored payloads and metadata**

- **`StoredRecordPayload`**
  - **Module:** `secret_types`
  - **Wire / meaning:** opaque on-disk ciphertext / JSON blob
- **`StoredVaultYaml`**
  - **Module:** `vault_wire`
  - **Wire / meaning:** vault YAML blob
- **`SecretPayloadYaml`**
  - **Module:** `vault_wire`
  - **Wire / meaning:** typed secret YAML before encryption
- **`IsoTimestamp`**
  - **Module:** `vault_wire`
  - **Wire / meaning:** RFC 3339 timestamps (`created_at`, …)
- **`MemberLabel`**
  - **Module:** `vault_wire`
  - **Wire / meaning:** human device / member label
- **`PasswordEntryId`**
  - **Module:** `vault_wire`
  - **Wire / meaning:** password-unlock slot id

**Event construction and connection state**

- **`VaultEventSchemaVersion`**
  - **Module:** `vault_event`
  - **Wire / meaning:** event body `schema_version`
- **`ObservedHeads`**
  - **Module:** `vault_event_builder`
  - **Wire / meaning:** validated causal head set
- **`DecryptedPlaintext`**
  - **Module:** `vault_wire`
  - **Wire / meaning:** age-scrypt decrypt output (YAML or JSON)
- **`SigningSeedHex`**
  - **Module:** `vault_wire`
  - **Wire / meaning:** 64-hex Ed25519 signing seed
- **`VaultAccessStatus`**
  - **Module:** `vault_connect`
  - **Wire / meaning:** connect pre-flight tag (`new_vault`, `ready`, …)

### WASM / JS boundary

Keep identifiers and counts wrapped across the Rust/WASM boundary. Unwrap a
primitive only through an explicit edge getter when JavaScript must consume it.

`nook-wasm` getters may still return a wire `String` when the external API owns
that representation. Parse it into a newtype inside Rust before calling core.
Do not duplicate validation in TypeScript.

### Legitimately raw (for now)

- **`SecretValue` inner fields (`website_url`, `password`, …)**
  - **Reason:** Plaintext user content — not interchange IDs
- **`i18n` lookup keys**
  - **Reason:** Locale plumbing, not vault domain
- **`serde_json::Value` in canonical JSON**
  - **Reason:** Encoding primitive

## Domain API lint rollout

Development core owns `raw_numeric_public_api`, suppression validation, and rollout.
Both lints remain allow-by-default, so unmigrated crates remain unenforced until activated.
`nook-app-common`, `nook-authenticator-domain`, `nook-companion-core`, `nook-companion-wasm`, `nook-wasm`, `nook-replication`, `nook-auth2`, `nook-event-log`, and `nook-core` are activated.
Later crates migrate in dependency order.
Activate a migrated crate only while the Dylint library is loaded:

```rust
#![cfg_attr(dylint_lib = "nook_domain_api", forbid(invalid_raw_numeric_api_suppression))]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(raw_numeric_public_api))]
```

Boundary exceptions use an item-scoped `expect(raw_numeric_public_api, reason = "...")`.
The reason starts with `serialization boundary:`, `database boundary:`, or `FFI boundary:` and then explains the edge.
Crate, module, type, and other blanket `allow` or expectation attributes are forbidden.
Development core owns pass/fail UI fixtures, diagnostics snapshots, and staged crate activation.
Hosted validation runs the locked standalone lint tests with the repository-pinned nightly toolchain.
The lint inspects concrete declared parameter, return, and public field types.
It also inspects generic defaults, where clauses, associated type bounds, and enclosing impl or trait predicates.
Named-trait inspection covers both local and nonlocal traits.
Reachable external reexports and inherited methods must pass before staged crate activation.

## Remaining type-safety checklist

- [ ] Raw identifier and count primitives are absent from domain and WASM
      signatures unless an external protocol owns the representation.
- [ ] An explicit edge getter may unwrap a primitive for JavaScript.
- [ ] Infallible single-field wrappers implement `From<Primitive>`.
- [ ] Aggregate construction keeps independent field names visible.
- [ ] Associated constants cover only common values with stable meaning.

- [ ] `VaultEventSession` — `store_id: StoreId`, `heads: Vec<EventId>`, `key_epoch: KeyEpoch`
- [ ] `VaultProjection` maps — `BTreeMap<SecretId, …>` instead of `String` keys
- [x] `device_key_protection` — validated `DeviceKeyProtectionVersion`
- [x] `device_key_protection` — typed WebAuthn credential, user-handle, and PRF bytes
- [x] `sentinel_genesis` — validated `SentinelGenesisVersion`
- [x] `sentinel_genesis` command — typed participant count and threshold
- [x] `sentinel_unlock` — validated `SentinelUnlockVersion`
- [x] `sentinel_onboarding` — validated `SentinelOnboardingVersion`
- [x] `identity` — `IdentityControlEpoch`
- [x] `password_envelope` — `PasswordCharacterCount` for password policy bounds
- [x] password generation — `PasswordCharacterCount` for requested length
- [x] passkey secrets — validated `PasskeySecretVersion`
- [x] passkey secrets — `PasskeySignatureCount`
- [x] seed phrases — `Bip39MnemonicWordCount` for inferred supported lengths
- [x] seed phrases — `Bip39WordSuggestionLimit` for completion result bounds
- [x] seed phrases — `Bip39WordSequenceExpectedCount` for membership checks
- [x] secret imports — typed result counts, QR batch counts, and rejected 1PUX versions
- [x] secret presentation — typed seed-word, backup-code, and attachment-byte counts
- [x] authenticator codes — validated `TotpPeriod`
- [x] authenticator codes — `TotpRemainingSeconds`
- [x] authenticator codes — `TotpUnixSeconds` for code-generation instants
- [ ] `password_envelope` — `PasswordEnvelopeVersion`, typed `ciphertext` field on `PasswordEnvelope`
- [ ] `multi_device` — `SentinelShareVersion`
- [ ] `multi_device` — `MemberEntry.enrolled_at: IsoTimestamp`, `label: Option<MemberLabel>`
- [ ] `vault_sync` — `VaultContentHash` for revision hashes
- [x] `vault_sync` — `VaultSyncUnixMilliseconds` for successful-sync timestamps
- [x] `vault diagnostics` — `VaultEncryptedPayloadCount` for event payload counts
- [x] search catalog — `SecretSearchCatalogChangeCount` for reconciliation outcomes
- [x] Core domain API activation — typed vault/sync APIs plus typed Auth2 and Event Log facade contracts
- [x] `SigningIdentity::actor_id()` → `AuthKeyId`
- [x] `access_status_for_vault_content` → `VaultAccessStatus`
- [x] `serialize_stored_*` → `StoredVaultYaml` / `StoredVaultBlob`
- [x] `sha256_hex()` → `Sha256Hex`; `VaultCrypto::decrypt_value` → `DecryptedPlaintext`
- [x] `apply_user_records_to_armored_session` → `Database`
- [x] `SigningIdentity::generate` seed → `SigningSeedHex`

## Related

- [secret-store-identity.md](../../security/architecture/secret-store-identity.md) — `store_id` / `pk_id` rationale
- [vault-event-log.md](vault-event-log.md) — event envelope fields
- [references/rust-wasm.md](../references/rust-wasm.md) — WASM boundary conventions
- [dynamic-skills/testing-pyramid-and-regression.md](../../../shared/dynamic-skills/testing-pyramid-and-regression.md) — domain testing standards
