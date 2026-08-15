# Typed Newtypes (Domain IDs & Wire Strings)

## Relationships

- [Reference: Rust + WebAssembly (wasm-bindgen)](../references/rust-wasm.md)
  - Defines the typed Rust-to-WASM implementation boundary.
  - Read when the design crosses from Rust into the web layer.
- [Nook Coding Rules & Golden Principles](../rules.md)
  - Defines the repository-wide implementation and security constraints.
  - Apply while turning this design into code.
- [Secret Store Identity](secret-store-identity.md)
  - Defines stable provider and secret-store identity across sessions.
  - Read when the design handles provider labels or store identifiers.
- [Vault Event Log](vault-event-log.md)
  - Defines durable vault events, ordering, and concurrency behavior.
  - Read when the design changes persistence or synchronization.

## Document map

- [Overview](#overview)
  - Status: In progress — prefer newtypes over raw String / u32 in nook-core domain APIs.
  - Read before changing or relying on Overview.
- [Why](#why)
  - A bare String does not tell the compiler what the value means.
  - Read before changing or relying on Why.
- [Inventory](#inventory)
  - Defines the concrete responsibilities and constraints for Inventory.
  - Read before changing or relying on Inventory.
  - [Implemented (nook-core)](#implemented-nook-core)
    - Summarizes the structured entries, ownership, and status for Implemented (nook-core).
    - Read before changing or relying on Implemented (nook-core).
  - [WASM / JS boundary](#wasm--js-boundary)
    - nook-wasm getters may still return String / Option<String>.
    - Read before changing or relying on WASM / JS boundary.
  - [Legitimately raw (for now)](#legitimately-raw-for-now)
    - Summarizes the structured entries, ownership, and status for Legitimately raw (for now).
    - Read before changing or relying on Legitimately raw (for now).
- [Patterns](#patterns)
  - Defines the concrete responsibilities and constraints for Patterns.
  - Read before changing or relying on Patterns.
  - [Serde-transparent string newtype](#serde-transparent-string-newtype)
    - Wire JSON unchanged; Rust API is typed.
    - Read before changing or relying on Serde-transparent string newtype.
  - [Macro (vault_wire.rs)](#macro-vault_wirers)
    - transparent_str_newtype!
    - Read before changing or relying on Macro (vaultwire.rs).
  - [Version newtype](#version-newtype)
    - When a breaking wire shape ships, add V2, keep V1 deserializable, and branch in projection/import — never bump CURRENT without a.
    - Read before changing or relying on Version newtype.
  - [Trusted construction](#trusted-construction)
    - from_trusted / from_vault_record for values already validated or emitted by this process.
    - Read before changing or relying on Trusted construction.
- [Remaining type-safety checklist](#remaining-type-safety-checklist)
  - [ ] VaultEventSession — store_id: StoreId, heads: Vec<EventId>, key_epoch: KeyEpoch[ ] VaultProjection maps — BTreeMap<SecretId,.
  - Use while executing or reviewing Remaining type-safety checklist.
- [Related](#related)
  - secret-store-identity.md — store_id / pk_id rationalevault-event-log.md — event envelope fieldsreferences/rust-wasm.md — WASM.
  - Read before changing or relying on Related.

## Overview

**Status:** In progress — prefer newtypes over raw `String` / `u32` in `nook-core` domain APIs.

## Why

A bare `String` does not tell the compiler what the value *means*. `DevicePublicKey` vs `DeviceSigningPublicKey` vs `SymmetricKey` are all strings on the wire but must never be swapped. Newtypes make intent explicit and turn mix-ups into compile errors.

The vault will carry **multiple schema versions** concurrently (events, envelopes, projection). Version fields should be newtypes (`VaultEventSchemaVersion`, `PasswordEnvelopeVersion`, …) so each struct's supported range is checked at parse time, not ad-hoc `u32` comparisons scattered through the code.

## Inventory

### Implemented (`nook-core`)

| Newtype | Module | Wire / meaning |
|---------|--------|----------------|
| `CompactToken` | `vault_ids` | 11-char base64url random suffix |
| `StoreId` | `vault_ids` | `store_{token}` vault identity |
| `SecretId` | `vault_ids` | `secret_{token}` |
| `AuthKeyId` | `vault_ids` | `key_{sha256_hex}` actor / auth row |
| `DeviceId` | `vault_ids` | 16-hex device fingerprint |
| `EventId` | `event_canonical` | `sha256u:{base64url_no_pad}` content-addressed event |
| `KeyEpoch` | `vault_epoch` | wraps `EventId` — epoch protecting payloads |
| `Ed25519Signature` | `event_canonical` | `ed25519:{hex}` event signature |
| `Sha256Hex` | `vault_wire` | bare 64-hex digest (content hash, checkpoint) |
| `DeviceSigningPublicKey` | `vault_wire` | 64-hex Ed25519 verifying key bytes |
| `SymmetricKey` | `vault_wire` | 64-hex vault symmetric key |
| `DevicePublicKey` | `vault_wire` | age X25519 recipient string |
| `DeviceIdentitySecret` | `vault_wire` | age X25519 identity secret |
| `AgeArmoredCiphertext` | `vault_wire` | age armor block |
| `StoredRecordPayload` | `secret_types` | opaque on-disk ciphertext / JSON blob |
| `StoredVaultYaml` | `vault_wire` | vault YAML blob |
| `SecretPayloadYaml` | `vault_wire` | typed secret YAML before encryption |
| `IsoTimestamp` | `vault_wire` | RFC 3339 timestamps (`created_at`, …) |
| `MemberLabel` | `vault_wire` | human device / member label |
| `PasswordEntryId` | `vault_wire` | password-unlock slot id |
| `VaultEventSchemaVersion` | `vault_event` | event body `schema_version` |
| `ObservedHeads` | `vault_event_builder` | validated causal head set |
| `DecryptedPlaintext` | `vault_wire` | age-scrypt decrypt output (YAML or JSON) |
| `SigningSeedHex` | `vault_wire` | 64-hex Ed25519 signing seed |
| `VaultAccessStatus` | `vault_connect` | connect pre-flight tag (`new_vault`, `ready`, …) |

### WASM / JS boundary

`nook-wasm` getters may still return `String` / `Option<String>`. Parse into newtypes **inside** Rust before calling `nook-core`. Do not duplicate validation in TypeScript.

### Legitimately raw (for now)

| Type | Reason |
|------|--------|
| `SecretValue` inner fields (`website_url`, `password`, …) | Plaintext user content — not interchange IDs |
| `i18n` lookup keys | Locale plumbing, not vault domain |
| `serde_json::Value` in canonical JSON | Encoding primitive |

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

- [secret-store-identity.md](secret-store-identity.md) — `store_id` / `pk_id` rationale
- [vault-event-log.md](vault-event-log.md) — event envelope fields
- [references/rust-wasm.md](../references/rust-wasm.md) — WASM boundary conventions
- [rules.md §4](../rules.md#4-testing-requirements) — type safety in tests
