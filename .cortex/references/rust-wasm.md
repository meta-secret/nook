# Reference: Rust + WebAssembly (wasm-bindgen)

## 1. Wasm Bindgen Setup
- Use `wasm-bindgen = "0.2.125"` (see workspace `Cargo.toml`).
- Export functions with `#[wasm_bindgen]`. Domain logic stays in `nook-core`; WASM wraps I/O and session state.
- Examples: `connect`, `add_secret`, `filter_secrets`, `generate_password`.

## 2. Compiling for the web
- Invoke wasm-pack from the **workspace root** so chef-cached `target/` is reused:
  `wasm-pack build nook-wasm --target web --out-dir ../nook-web/src/lib/nook-wasm --out-name nook_wasm`
- **Docker bake** runs wasm-pack once (release + `wasm-opt`) in `builder-wasm` and stamps `.wasm-source-sha256` beside the pkg. In-container `task _wasm:build` skips when that hash matches — do not rely on file mtimes (COPY makes sources look newer than the baked wasm pkg).
- **CI** (`_ci:pr`, `_ci:main`) does not call `_wasm:build`; the sealed nook-web image already ships the optimized pkg from bake.
- The Docker image installs `wasm-pack` via the [official init script](https://wasm-bindgen.github.io/wasm-pack/installer/) (pinned with `VERSION`). `wasm-pack build` installs the matching `wasm-bindgen-cli` itself — not `cargo install`. **Binaryen (`wasm-opt`) is baked into the base image** (pinned `BINARYEN_VERSION`, installed to `/usr/local/bin`) so wasm-pack runs post-link optimization with a correct, local `wasm-opt` and never downloads it at build time (a modern version is required — old Debian binaryen corrupts `externref` tables).

## 3. Session state (`NookVaultManager`)
- `decrypted_jsonl` — in-memory plaintext session (JSONL)
- `stored_armored` — per-key armored ciphertext cache (incremental saves)
- `crypto` — `nook_core::VaultCrypto` (derived once per connect)
- GitHub/IndexedDB I/O via `reqwest` / `rexie` — not in `nook-core`

## 4. Typed WASM boundary (`nook-wasm/src/types.rs`)

**Prefer typed `#[wasm_bindgen]` structs over raw `JsValue`, `js_sys::Array`, and `Reflect`.** Errors may still surface as `JsError`; data crossing the boundary should not.

| Export | Use |
|--------|-----|
| `NookSecretRecord` | Decrypted vault items (getters + view helpers) |
| `NookJoinRequest` | Pending device join rows (`deviceId`, `publicKey`, `requestedAt`) |
| `NookVaultMember` | Enrolled devices (`authId`, `deviceId`, …) |
| `NookPasswordEntrySummary` | Backup-password list entries |
| `NookVaultSyncResult` | `sync_vault_from_storage` payload (`changed`, `accessStatus`, `secrets`, `pendingJoins`, `vaultMembers`) |
| `NookRemoteVaultFetch` | `fetchRemoteVaultYaml` |
| `NookReconcileVaultBlobsResult` | `reconcileVaultBlobs` |
| `NookResolveConflictKeepLocalResult` / `NookResolveConflictKeepRemoteResult` | conflict resolution |
| `NookSecretFormFields` | `buildSecretYaml` input (flat constructor; unused fields empty) |

**Web layer:** import these types from `./nook-wasm/nook_wasm` (or re-export via `nook.ts`). Do **not** add TS mappers that rebuild plain objects from wasm output.

## 5. Vault secrets at the JS boundary

**Canonical schema:** `nook-core/src/secret_types.rs` (`SecretType`, payload structs, `SecretValue`, `SecretRecord`).

**Typed domain strings:** Prefer newtypes over raw `String` / `u32` in `nook-core`. Primary modules: `vault_wire.rs` (crypto/wire blobs), `vault_ids.rs` (prefixed ids), `event_canonical.rs` (`EventId`, `Ed25519Signature`), `vault_event.rs` (event envelope + `VaultEventSchemaVersion`). Inventory and versioning rules: [design-docs/typed-newtypes.md](../design-docs/typed-newtypes.md).

WASM boundary getters may still return `String`; parse with `Foo::parse` / `Deserialize` before calling core. Use `.as_str()` / `.into_inner()` only at the JS edge.

**Do not duplicate in TypeScript.** The web UI consumes `NookSecretRecord` wasm objects with typed getters (`websiteUrl`, `username`, `password`, …) and view helpers (`groupKey`, `summary`, `matchesSearch`, `primaryCredential`).

| Layer | Responsibility |
|-------|----------------|
| `nook-core` | Schema, validation, YAML parse/serialize, display/search helpers (`secret_view.rs`) |
| `nook-wasm` | Typed boundary structs, `buildSecretYaml`, session CRUD |
| `nook-web` | Svelte forms + rendering; `VaultItemType` string union for the type picker only |

**Reads:** `records_to_vec` builds `Vec<NookSecretRecord>` from `nook_core::SecretRecord` — no YAML round-trip to JS.

**Writes:** Forms construct `NookSecretFormFields`, call `buildSecretYaml(type, fields)` (Rust validation), then `add_secret` / `replace_secret`. New item ids use `NookVaultManager.generate_secret_id()`.

**Mobile / other hosts:** Link `nook-core` directly (UniFFI, JNI, etc.) and reuse the same `SecretRecord`, `SecretValue`, and `secret_view` helpers — no TS mirror required.

### Adding a new secret type

1. **`nook-core/src/secret_types.rs`** — new `SecretType` variant, payload struct, `SecretValue` arms in `from_yaml` / `to_yaml`.
2. **`nook-core/src/secret_view.rs`** — update `display_title`, `group_key`, `summary`, `matches_search`, and `build_secret_yaml` arms.
3. **`nook-wasm/src/lib.rs`** — add typed getters on `NookSecretRecord` for the new fields.
4. **`nook-core` tests** — round-trip and validation tests (authority for payload behavior).
5. **`nook-web`** — add-secret form fields + `SecretDetailRow` rendering only. **No** new TS struct mirror or `parseVaultItem` arm.
6. **Playwright** — e2e for the new form if user-visible.

## 6. Testing
- Test vault formats, crypto, validation, and passwords in `nook-core`.
- **Coverage gate:** `task rust:coverage:check` (llvm-cov + nextest, **90%** line floor in `nook-core/coverage-floor.json`). Part of `task check` / CI. Below 90%, add Rust tests.
- **Fast tests:** `task rust:test` (nextest only, no coverage instrumentation).
- Use Playwright e2e for UI flows; do not duplicate domain rules in TypeScript tests.
