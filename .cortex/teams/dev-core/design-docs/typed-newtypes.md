# Typed Newtypes (Domain IDs & Wire Strings)

## Overview

**Status:** In progress — prefer domain wrappers over raw primitives in Rust
domain APIs and typed WASM boundaries.

## Why

A bare primitive does not tell the compiler what the value means. This applies
to identifiers, counts, versions, and wire strings.

`DevicePublicKey`, `DeviceSigningPublicKey`, and `SymmetricKey` are strings on
the wire. They must never be swapped. Newtypes make intent explicit and turn
mix-ups into compile errors.

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

## Patterns

### Single-field primitive wrapper

Use one wrapper for each domain meaning.

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FieldIndex {
    pub value: u32,
}

impl From<u32> for FieldIndex {
    fn from(value: u32) -> Self {
        Self { value }
    }
}

impl FieldIndex {
    pub const ZERO: Self = Self { value: 0 };
    pub const ONE: Self = Self { value: 1 };
}
```

- Use `From<Primitive>` for an infallible single-field wrapper.
- Use a parser or `TryFrom` when construction validates the value.
- Add associated constants only for common values with stable meaning.
- Keep dynamic values on the normal conversion path.
- Preserve the wrapper through domain and WASM calls.
- Expose the primitive only at an explicit external edge.
- Use `#[serde(transparent)]` only when the owned wire format must remain the
  primitive.
- Keep a named `value` field when the serialized contract must retain the
  wrapper shape.

### Aggregate construction

Construct aggregates with named fields.

```rust
let credential = Credential {
    field_index,
    role,
    editability,
};
```

- Do not implement `From<(A, B, C)>` for independent aggregate fields.
- Do not add a trivial `new(a, b, c)` that only hides those field names.
- Reserve `From<T>` for one clear semantic conversion.
- Keep aggregate validation in a named fallible constructor when it enforces an
  invariant.

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

- [ ] Raw identifier and count primitives are absent from domain and WASM
      signatures unless an external protocol owns the representation or an
      explicit edge getter unwraps the value for JavaScript.
- [ ] Infallible single-field wrappers implement `From<Primitive>`.
- [ ] Aggregate construction keeps independent field names visible.
- [ ] Associated constants cover only common values with stable meaning.

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
