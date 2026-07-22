# Reference: Rust + WebAssembly (wasm-bindgen)

## 1. Wasm Bindgen Setup
- Use `wasm-bindgen = "0.2.125"` (see workspace `nook-app/Cargo.toml`).
- Export functions with `#[wasm_bindgen]`. Domain logic stays in `nook-core`; WASM wraps I/O and session state.
- Examples: `connect`, `add_secret`, `filter_secrets`, `generate_password`.

## 2. Compiling for the web
- `task wasm:build` invokes wasm-pack exactly once from the **Rust workspace root** (`nook-app`) on the featureless `nook-wasm` bridge. The resulting generated package is shared by Unified, Simple, Sentinel, and extension consumers; immutable Rust-owned application configuration and manager capability checks enforce the active realm at runtime.
- **Build mode:** `WASM_BUILD_MODE` defaults to `dev`, which runs release `wasm-pack` with `--no-opt` and stamps `.wasm-source-sha256` with `no-opt`. `WASM_BUILD_MODE=prod` runs the Binaryen `wasm-opt` pass and stamps `optimized`. Local `task check`, `task setup`, `task web:dev`, `task wasm:build`, PR CI, and main development delivery use dev mode; release CI passes `WASM_BUILD_MODE=prod`.
- **Fast local iteration:** `task wasm:build:fast` regenerates the web pkg on the mounted worktree in dev/no-opt mode. It uses the existing `nook-web:local` image and bind-mounts the worktree; run `task setup` once first if that image does not exist. `task wasm:build:prod` is the explicit optimized local path.
- **CI** does not rely on defaults: PR and main CI call Task with `WASM_BUILD_MODE=dev` to skip `wasm-opt`; release alone calls Task with `WASM_BUILD_MODE=prod` so stable artifacts are optimized exactly once.
- **Tests:** PR/main verification runs `task wasm:test`, which executes default wasm-bindgen tests in Node via `wasm-pack test --node nook-wasm`. Browser-only IndexedDB tests are feature-gated behind `browser-wasm-tests` and run manually with `task wasm:test:browser`.
- The Docker image installs `wasm-pack` via the [official init script](https://wasm-bindgen.github.io/wasm-pack/installer/) (pinned with `VERSION`). `wasm-pack build` installs the matching `wasm-bindgen-cli` itself — not `cargo install`. **Binaryen (`wasm-opt`) is baked into the base image** (pinned `BINARYEN_VERSION`, installed to `/usr/local/bin`) so wasm-pack runs post-link optimization with a correct, local `wasm-opt` and never downloads it at build time (a modern version is required — old Debian binaryen corrupts `externref` tables).

## 3. Session state (`NookVaultManager`)
- `meta.secrets` — per-key armored ciphertext for the unlocked vault; the
  manager does not retain a hydrated plaintext `Database`
- `crypto` — `nook_core::VaultCrypto` (derived once per connect)
- `querySecretPage` — briefly decrypts only the requested page (maximum 100
  records; the web app uses 50), zeroizes each full record, and returns a typed
  metadata-only `NookSecretPage`
- `decryptSecret` — decrypts exactly one full `NookSecretRecord` for an explicit
  reveal or secret-value copy
- encrypted search catalog — decrypts authenticated ID-derived buckets once per
  unlocked session, then scans normalized metadata in WASM memory
- GitHub/IndexedDB I/O via `reqwest` / `rexie` — not in `nook-core`

## 3a. Browser API boundaries

- Prefer Rust wrapper crates over direct Web APIs in `nook-wasm`: use
  `gloo-storage` for `sessionStorage`/`localStorage`, `gloo-file` for browser
  file reads, `rexie` for IndexedDB, and `reqwest` for provider HTTP calls.
- Avoid direct `web-sys`/`js-sys` in normal WASM code. If no wrapper exists for
  a narrow browser API, isolate the direct call in the smallest adapter module
  and keep it out of domain/session policy.
- Browser lifecycle glue belongs in TypeScript/Svelte: DOM event listeners,
  timers, Vite `import.meta.env` parsing, viewport/URL state, and UI callbacks.
  The closer a behavior is to `document`, `window`, or rendering lifecycle, the
  more strongly it belongs in `nook-web`.
- `nook-wasm` may own durable browser storage/provider adapters and typed
  manager state; `nook-web` owns presentation and browser orchestration.

## 4. Typed WASM boundary (`nook-app/nook-wasm/src/types.rs`)

**Use typed `#[wasm_bindgen]` structs instead of raw JavaScript values for every application data shape.** Errors surface as `JsError`. Browser adapters use the narrowest typed `web-sys` / `js-sys` object supported by the external API. Syntax-aware repository preflight rejects authored `JsValue` paths before wasm-bindgen macro expansion; Clippy's built-in `disallowed_types` cannot distinguish wasm-bindgen's generated ABI code from authored code.

| Export | Use |
|--------|-----|
| `NookSecretListItem` | Metadata-only list item with no credential/body getters |
| `NookSecretRecord` | One explicitly decrypted vault item; freed on hide/action completion |
| `NookSecretPage` | Page-scoped metadata items plus total/offset/limit |
| `NookJoinRequest` | Pending device join rows (`deviceId`, `publicKey`, `requestedAt`) |
| `NookVaultMember` | Enrolled devices (`authId`, `deviceId`, …) |
| `NookPasswordEntrySummary` | Backup-password list entries |
| `NookVaultSyncResult` | `sync_vault_from_storage` payload (`changed`, `accessStatus`, `secrets`, `pendingJoins`, `vaultMembers`) |
| `NookVaultClientPolicy` | Portable login, lock, sync, join, remote-recovery, vault-switch, and pagination decisions |
| `NookRemoteVaultFetch` | `fetchRemoteVaultYaml` |
| `NookReconcileVaultBlobsResult` | `reconcileVaultBlobs` |
| `NookResolveConflictKeepLocalResult` / `NookResolveConflictKeepRemoteResult` | conflict resolution |
| `NookSecretFormFields` | `buildSecretYaml` input (flat constructor; unused fields empty) |

Provider list scoping, locked-device visibility, staged connect arguments,
remote-reference normalization, and sync metadata updates cross the boundary as
Rust-owned functions over typed provider rows. Svelte may clone reactive values
into plain boundary inputs, but must not reproduce those decisions.

**Web layer:** import these types from `./nook-wasm/nook_wasm` (or re-export via `nook.ts`). Do **not** add TS mappers that rebuild plain objects from wasm output.

**Generated wrapper ownership:** a generated wasm-bindgen class passed by value
is consumed by the call (`__destroy_into_raw()` clears its JavaScript pointer).
Do not call `.free()` on that wrapper afterward, including from a promise
`finally`; doing so throws `null pointer passed to rust` and can turn a
successful async Rust operation into a rejected JavaScript promise. Continue to
free wrappers returned to JavaScript after their data has been copied out.

## 5. Vault secrets at the JS boundary

**Canonical schema:** `nook-app/nook-core/src/secret_types.rs` (`SecretType`, payload structs, `SecretValue`, `SecretRecord`).

**Typed domain strings:** Prefer newtypes over raw `String` / `u32` in `nook-core`. Primary modules: `vault_wire.rs` (crypto/wire blobs), `vault_ids.rs` (prefixed ids), `event_canonical.rs` (`EventId`, `Ed25519Signature`), `vault_event.rs` (event envelope + `VaultEventSchemaVersion`). Inventory and versioning rules: [design-docs/typed-newtypes.md](../design-docs/typed-newtypes.md).

WASM boundary getters may still return `String`; parse with `Foo::parse` / `Deserialize` before calling core. Use `.as_str()` / `.into_inner()` only at the JS edge.

**Do not duplicate in TypeScript.** List/search UI consumes
`NookSecretListItem`; it cannot access password, API key, seed words, login
notes, or secure-note bodies. Explicit reveal/copy calls return one
`NookSecretRecord`, which must be freed as soon as the action or revealed state
ends.

| Layer | Responsibility |
|-------|----------------|
| `nook-core` | Schema, validation, YAML parse/serialize, display/search helpers (`secret_view.rs`) |
| `nook-wasm` | Typed boundary structs, `buildSecretYaml`, session CRUD |
| `nook-web` | Svelte forms + rendering; `VaultItemType` string union for the type picker only |

**Reads:** page queries convert decrypted records into
`Vec<NookSecretListItem>` and zeroize the full records before returning.
`decryptSecret(id)` is the only list-flow path that creates a full
`NookSecretRecord` in JavaScript.

**Writes:** Forms construct `NookSecretFormFields`, call `buildSecretYaml(type, fields)` (Rust validation), then `add_secret` / `replace_secret`. New item ids use `NookVaultManager.generate_secret_id()`.

**Mobile / other hosts:** Link `nook-core` directly (UniFFI, JNI, etc.) and reuse the same `SecretRecord`, `SecretValue`, and `secret_view` helpers — no TS mirror required.

### Adding a new secret type

1. **`nook-app/nook-core/src/secret_types.rs`** — new `SecretType` variant, payload struct, `SecretValue` arms in `from_yaml` / `to_yaml`.
2. **`nook-app/nook-core/src/secret_view.rs`** — update `display_title`, `group_key`, `summary`, `matches_search`, and `build_secret_yaml` arms.
3. **`nook-app/nook-wasm/src/lib.rs`** — add typed getters on `NookSecretRecord` for the new fields.
4. **`nook-app/nook-core` tests** — round-trip and validation tests (authority for payload behavior).
5. **`nook-app/nook-web`** — add-secret form fields + `SecretDetailRow` rendering only. **No** new TS struct mirror or `parseVaultItem` arm.
6. **Playwright** — e2e for the new form if user-visible.

## 6. Testing
- Test vault formats, crypto, validation, and passwords in `nook-core`.
- **Coverage gate:** `task rust:coverage:check` (llvm-cov + nextest, **90%** line floor in `nook-app/nook-core/coverage-floor.json`). Part of `task check` / CI. Below 90%, add Rust tests.
- **Fast tests:** `task rust:test` (nextest only, no coverage instrumentation).
- Use Playwright e2e for UI flows; do not duplicate domain rules in TypeScript tests.
