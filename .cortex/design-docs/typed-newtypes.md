# Typed Newtypes (Domain IDs & Wire Strings)

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
| `SecretId` | `vault_ids` | `secret_{token}` or legacy human label |
| `AuthKeyId` | `vault_ids` | `key_{sha256_hex}` actor / auth row |
| `DeviceId` | `vault_ids` | 16-hex device fingerprint |
| `EventId` | `event_canonical` | `sha256:{hex}` content-addressed event |
| `KeyEpoch` | `vault_epoch` | wraps `EventId` — epoch protecting payloads |
| `Ed25519Signature` | `event_canonical` | `ed25519:{hex}` event signature |
| `Sha256Hex` | `vault_wire` | bare 64-hex digest (content hash, checkpoint) |
| `DeviceSigningPublicKey` | `vault_wire` | 64-hex Ed25519 verifying key bytes |
| `SymmetricKey` | `vault_wire` | 64-hex vault symmetric key |
| `DevicePublicKey` | `vault_wire` | age X25519 recipient string |
| `DeviceIdentitySecret` | `vault_wire` | age X25519 identity secret |
| `AgeArmoredCiphertext` | `vault_wire` | age armor block |
| `StoredRecordPayload` | `secret_types` | opaque on-disk ciphertext / JSON blob |
| `SessionJsonl` / `StoredVaultJsonl` / `StoredVaultYaml` | `vault_wire` | session / vault wire blobs |
| `SecretPayloadYaml` | `vault_wire` | typed secret YAML before encryption |
| `IsoTimestamp` | `vault_wire` | RFC 3339 timestamps (`created_at`, …) |
| `MemberLabel` | `vault_wire` | human device / member label |
| `PasswordEntryId` | `vault_wire` | password-unlock slot id |
| `VaultEventSchemaVersion` | `vault_event` | event body `schema_version` |
| `ObservedHeads` | `vault_event_builder` | validated causal head set |
| `GithubPat`, `GithubRepoName`, … | `validation` | sync-provider credentials |

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

## Migration checklist (remaining)

- [ ] `VaultEventSession` — `store_id: StoreId`, `heads: Vec<EventId>`, `key_epoch: KeyEpoch`
- [ ] `VaultProjection` maps — `BTreeMap<SecretId, …>` instead of `String` keys
- [ ] `password_envelope` — `PasswordEnvelopeVersion`, typed `ciphertext`
- [ ] `multi_device` — `MemberEntry.enrolled_at: IsoTimestamp`, `label: Option<MemberLabel>`
- [ ] `vault_sync` — `VaultContentHash` for revision hashes
- [ ] `SigningIdentity::actor_id()` → return `AuthKeyId` instead of `String`

## Related

- [secret-store-identity.md](secret-store-identity.md) — `store_id` / `pk_id` rationale
- [vault-event-log.md](vault-event-log.md) — event envelope fields
- [references/rust-wasm.md](../references/rust-wasm.md) — WASM boundary conventions
- [rules.md §4](../rules.md#4-testing-requirements) — type safety in tests
