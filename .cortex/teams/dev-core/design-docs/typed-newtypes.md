# Typed Newtypes (Domain IDs & Wire Strings)

## Overview

**Status:** In progress — prefer newtypes over raw `String` / `u32` in `nook-core` domain APIs.

## Why

A bare `String` does not tell the compiler what the value _means_. `DevicePublicKey` vs `DeviceSigningPublicKey` vs `SymmetricKey` are all strings on the wire but must never be swapped. Newtypes make intent explicit and turn mix-ups into compile errors.

The vault will carry **multiple schema versions** concurrently (events, envelopes, projection). Version fields should be newtypes (`VaultEventSchemaVersion`, `PasswordEnvelopeVersion`, …) so each struct's supported range is checked at parse time, not ad-hoc `u32` comparisons scattered through the code.

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

`nook-wasm` getters may still return `String` / `Option<String>`. Parse into newtypes **inside** Rust before calling `nook-core`. Do not duplicate validation in TypeScript.

### Legitimately raw (for now)

- **`SecretValue` inner fields (`website_url`, `password`, …)**
  - **Reason:** Plaintext user content — not interchange IDs
- **`i18n` lookup keys**
  - **Reason:** Locale plumbing, not vault domain
- **`serde_json::Value` in canonical JSON**
  - **Reason:** Encoding primitive

## Patterns

### Serde-transparent string newtype

```rust
#[derive(Serialize, Deserialize)]
#[serde(transparent)]
pub struct StoreId(String);
```

Wire JSON unchanged; Rust API is typed. Validate in `parse()` and in `Deserialize` when invariants matter (`SymmetricKey`, `EventId`, …).

### Macro (`vault_wire.rs`)

`transparent_str_newtype!` generates `as_str`, `into_inner`, `Display`, `AsRef<str>`, and `Serialize`. Add custom `parse` + `Deserialize` when validation is required.

### Version newtype

```rust
pub struct VaultEventSchemaVersion(u32);

impl VaultEventSchemaVersion {
    pub const V1: Self = Self(1);
    pub const CURRENT: Self = Self::V1;
}
```

When a breaking wire shape ships, add `V2`, keep `V1` deserializable, and branch in projection/import — never bump `CURRENT` without a migration path. Future shape:

```rust
enum VersionedVaultEventBody {
    V1(VaultEventBodyV1),
    V2(VaultEventBodyV2),
}
```

### Trusted construction

`from_trusted` / `from_vault_record` for values already validated or emitted by this process. Do not use for external input.

## Domain API lint rollout

Development core owns `raw_numeric_public_api`, suppression validation, and rollout.
Both lints remain allow-by-default, so unmigrated crates remain unenforced until activated.
`nook-app-common` is the first clean activation; later crates migrate in dependency order.
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
Phase 1 inspects concrete declared parameter, return, and public field types; it does not enforce generic predicates.
One mandatory phase-2 semantic public-surface PR covers generic predicates and defaults, where clauses, associated type bounds, and enclosing impl or trait predicates.
It also covers local and nonlocal named traits, reexports, and inherited methods before `nook-authenticator-domain` activation.

## Remaining type-safety checklist

- [ ] `VaultEventSession` — `store_id: StoreId`, `heads: Vec<EventId>`, `key_epoch: KeyEpoch`
- [ ] `VaultProjection` maps — `BTreeMap<SecretId, …>` instead of `String` keys
- [ ] `password_envelope` — `PasswordEnvelopeVersion`, typed `ciphertext` field on `PasswordEnvelope`
- [ ] `multi_device` — `MemberEntry.enrolled_at: IsoTimestamp`, `label: Option<MemberLabel>`
- [ ] `vault_sync` — `VaultContentHash` for revision hashes
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
