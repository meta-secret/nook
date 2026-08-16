# Reference: Rust + WebAssembly (wasm-bindgen)

## Relationships

- [Typed Newtypes (Domain IDs & Wire Strings)](../design-docs/typed-newtypes.md)
  - Provides the Typed Newtypes (Domain IDs & Wire Strings) architecture context.
  - Read when changing the related design.
- [Quality and Release](../workflows/quality.md)
  - Defines the Quality and Release workflow referenced here.
  - Read before performing that workflow.

## Document map

- [1. Wasm Bindgen Setup](#1-wasm-bindgen-setup)
  - Defines the Rust-to-WASM binding setup.
  - Read before exposing Rust behavior to the web layer.
- [2. Compiling for the web](#2-compiling-for-the-web)
  - Lists the supported web compilation path.
  - Read when building or refreshing generated WASM artifacts.
- [3. Session state (NookVaultManager)](#3-session-state-nookvaultmanager)
  - Defines session-state ownership in `NookVaultManager`.
  - Read before changing vault lifecycle state across WASM.
- [3a. Browser API boundaries](#3a-browser-api-boundaries)
  - Defines what the guidance covers and where its ownership ends.
  - Read before expanding or assigning the work.
- [4. Typed WASM boundary (nook-app/nook-platform/nook-wasm/src/types.rs)](#4-typed-wasm-boundary-nook-appnook-platformnook-wasmsrctypesrs)
  - Defines what the guidance covers and where its ownership ends.
  - Read before expanding or assigning the work.
- [5. Vault secrets at the JS boundary](#5-vault-secrets-at-the-js-boundary)
  - Defines what the guidance covers and where its ownership ends.
  - Read before expanding or assigning the work.
  - [Adding a new secret type](#adding-a-new-secret-type)
    - Lists the required core, WASM, web, and test changes.
    - Follow from the start of new vault-item implementation.
- [6. Testing](#6-testing)
  - Defines the evidence and checks required for completion.
  - Use before declaring the work complete.

## 1. Wasm Bindgen Setup
- Use `wasm-bindgen = "0.2.127"` (see workspace
  `nook-app/nook-platform/Cargo.toml`).
- Export functions with `#[wasm_bindgen]`. Domain logic stays in `nook-core`; WASM wraps I/O and session state.
- Keep exported function and method names unchanged. Do not add callable
  `js_name` overrides. Generated TypeScript calls the authored Rust name, even
  when that means `snake_case`. Property accessors and imported JavaScript APIs
  may still use `js_name` for the external property or API they represent.
- Examples: `connect`, `add_secret`, `filter_secrets`, `generate_password`.

## 2. Compiling for the web

- `task wasm:build` invokes wasm-pack from the **Rust workspace root**
  (`nook-app/nook-platform`) for two packages:
  - the featureless `nook-wasm` vault bridge (Unified/Simple/Sentinel/extension
    background); and
  - tiny `nook-companion-wasm` (content-script heuristics + host policy).
- Realm enforcement stays in Rust-owned application configuration for the vault
  package.

**Build mode**

- `WASM_BUILD_MODE` defaults to `dev`.
- Dev mode runs release `wasm-pack` with `--no-opt` and stamps
  `.wasm-source-sha256` with `no-opt`.
- `WASM_BUILD_MODE=prod` runs the Binaryen `wasm-opt` pass and stamps
  `optimized`.
- Local `task check`, `task setup`, `task web:dev`, `task wasm:build`, PR CI,
  and main development delivery use dev mode.
- Release CI passes `WASM_BUILD_MODE=prod`.

**Fast local iteration**

- `task wasm:build:fast` regenerates the web pkg on the mounted worktree in
  dev/no-opt mode.
- It uses the existing `nook-web:local` image and bind-mounts the worktree.
- Run `task setup` once first if that image does not exist.
- `task wasm:build:prod` is the explicit optimized local path.

- **CI:** PR and main call Task with `WASM_BUILD_MODE=dev` to skip `wasm-opt`.
  - Release alone uses `WASM_BUILD_MODE=prod` so stable artifacts are optimized
    exactly once.
- **Default tests:** PR/main runs `task wasm:test`.
  - Execute wasm-bindgen tests in Node through
    `wasm-pack test --node --release nook-wasm`.
  - Keep Node tests in release mode to reuse the release dependency lineage.
  - Compile that release test graph as a sibling of `wasm-pack build`.
  - Do not rebuild workspace crates at the Node-test join after the lib-only
    export path.
- **Browser tests:** Gate IndexedDB tests behind `browser-wasm-tests` and run
  them manually with `task wasm:test:browser`.

**Rust quality capabilities**

Labeled product PR validation, Main, and thin `rust-ecosystem.yml` specialist
entry points share the same ecosystem gates. Those gates supplement Clippy,
unit tests, and coverage with:

- cargo-deny and RustSec dependency policy;
- Proptest generated invariants;
- Insta snapshots;
- Loom concurrency permutations;
- cargo-fuzz parser campaigns;
- Kani bounded proofs; and
- pinned Dylint libraries.

See [quality.md](../workflows/quality.md#quality-and-release) for the selection
rules and cost tiers.

- **Toolchain:** Install `wasm-pack` in Docker through the
  [official init script](https://wasm-bindgen.github.io/wasm-pack/installer/)
  pinned with `VERSION`.
  - Let `wasm-pack build` install the matching `wasm-bindgen-cli`; do not use
    `cargo install`.
- **Binaryen:** Bake `wasm-opt` into the base image with pinned
  `BINARYEN_VERSION` under `/usr/local/bin`.
  - Run post-link optimization with that local binary.
  - Never download it at build time.
  - Use a modern version because old Debian Binaryen corrupts `externref` tables.

## 3. Session state (`NookVaultManager`)
- `meta.secrets` — per-key armored ciphertext for the unlocked vault; the
  manager does not retain a hydrated plaintext `Database`
- `crypto` — `nook_core::VaultCrypto` (derived once per connect)
- `query_secret_page_js` — briefly decrypts only the requested page (maximum 100
  records; the web app uses 50), zeroizes each full record, and returns a typed
  metadata-only `NookSecretPage`
- `decrypt_secret_js` — decrypts exactly one full `NookSecretRecord` for an explicit
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

## 4. Typed WASM boundary (`nook-app/nook-platform/nook-wasm/src/types.rs`)

**Use typed `#[wasm_bindgen]` structs instead of raw JavaScript values for every
application data shape.** Errors surface as `JsError`. Browser adapters use the
narrowest typed `web-sys` / `js-sys` object supported by the external API.

Syntax-aware repository preflight rejects authored `JsValue` paths before
wasm-bindgen macro expansion. Clippy's built-in `disallowed_types` cannot
distinguish wasm-bindgen's generated ABI code from authored code.

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
| `NookResolveConflictKeepLocalResult` / `NookResolveConflictKeepRemoteResult` | conflict resolution |
| `NookSecretFormFields` | WASM wrapper over core-owned variant-specific `SecretFormFields`; static constructors select the variant |

- **Rust decisions:** Provider scoping, locked-device visibility, staged connect
  arguments, remote-reference normalization, and sync metadata updates cross as
  Rust-owned functions over typed provider rows.
- **Svelte adapter:** It may clone reactive values into plain boundary inputs.
  It must not reproduce decisions.
- **Web imports:** Import generated types from `./nook-wasm/nook_wasm`, or
  re-export through `nook.ts`.
  - Do not add TypeScript mappers that rebuild plain objects from WASM output.
- **Generated wrapper ownership:** A wasm-bindgen class passed by value is
  consumed when `__destroy_into_raw()` clears its JavaScript pointer.
  - Do not call `.free()` afterward, including in promise `finally`.
  - That throws `null pointer passed to rust` and can reject an otherwise
    successful async Rust operation.
  - Continue freeing wrappers returned to JavaScript after copying out data.

## 5. Vault secrets at the JS boundary

- **Canonical schema:**
  `nook-app/nook-platform/nook-core/src/secrets/secret_types.rs` owns
  `SecretType`, payload structs, `SecretValue`, and `SecretRecord`.
- **Typed domain strings:** Prefer newtypes over raw `String` or `u32` in
  `nook-core`.

Primary modules:

- `vault_wire.rs` — crypto/wire blobs
- `vault_ids.rs` — prefixed ids
- `event_canonical.rs` — `EventId`, `Ed25519Signature`
- `vault_event.rs` — event envelope + `VaultEventSchemaVersion`

- **Inventory and versions:** Follow
  [typed newtypes](../design-docs/typed-newtypes.md).
- **Boundary strings:** WASM getters may return `String`.
  - Parse with `Foo::parse` or `Deserialize` before calling core.
  - Use `.as_str()` or `.into_inner()` only at the JavaScript edge.

When a core policy enum selects a user-facing message:

- keep the exhaustive enum-to-translation-key mapping beside that enum in
  `nook-core`;
- a typed WASM adapter may translate the selected key from the active catalog
  and return the render-ready message; and
- TypeScript/Svelte supplies reactive locale/catalog state and renders the
  result.

- **Domain enum mapping:** TypeScript/Svelte must not repeat the switch.
  - Apply this test to every web facade, not only large helpers.
- **Portable policy:** Predicates, normalization, parsing, ordering, fallback
  selection, pagination, interpolation, and derived DTO fields belong in
  `nook-core`.
  - `nook-wasm` exposes the typed result.
- **Permitted web switch:** Keep a switch over a Rust decision only when its
  branches apply Svelte state or invoke browser lifecycle operations.
  - Data, label, key, or message selection belongs in Rust.
- **Web adapter inputs:** Browser time/API acquisition and conversion of Svelte
  proxies into plain typed values remain web responsibilities.
  - Arithmetic and policy over those values remain Rust responsibilities.
- **Long-running phase:** Expose the canonical phase as a Rust-owned
  `#[wasm_bindgen]` enum.
  - Keep loading, submitting, and browser-ceremony activity as host-only
    request flags.
  - Do not add transient UI states to the domain phase or mirror it with a
    TypeScript string union.

**Do not duplicate in TypeScript.** List/search UI consumes
`NookSecretListItem`; it cannot access password, API key, seed words, login
notes, or secure-note bodies. Explicit reveal/copy calls return one
`NookSecretRecord`, which must be freed as soon as the action or revealed state
ends.

| Layer | Responsibility |
|-------|----------------|
| `nook-core` | Schema, validation, YAML parse/serialize, display/search helpers (`secret_view.rs`) |
| `nook-wasm` | Typed boundary structs, `build_secret_yaml`, session CRUD |
| `nook-web` | Svelte forms and rendering; the type picker uses Rust-owned generated `SecretType` values |

**Reads:** page queries convert decrypted records into
`Vec<NookSecretListItem>` and zeroize the full records before returning.
`decrypt_secret_js(id)` is the only list-flow path that creates a full
`NookSecretRecord` in JavaScript.

**Writes:** Forms construct `NookSecretFormFields`, call `build_secret_yaml(fields)`
(Rust validation), then `add_secret` / `replace_secret`. New item ids use
`NookVaultManager.generate_secret_id()`.

**Mobile / other hosts:** Link `nook-core` directly (UniFFI, JNI, etc.) and reuse the same `SecretRecord`, `SecretValue`, and `secret_view` helpers — no TS mirror required.

### Adding a new secret type

1. **`nook-app/nook-platform/nook-core/src/secrets/secret_types.rs`** — new `SecretType` variant, payload struct, `SecretValue` arms in `from_yaml` / `to_yaml`.
2. **`nook-app/nook-platform/nook-core/src/secrets/secret_view.rs`** — update `display_title`, `group_key`, `summary`, `matches_search`, and `build_secret_yaml` arms.
3. **`nook-app/nook-platform/nook-wasm/src/secret_api/secret_record.rs`** — add typed getters on `NookSecretRecord` for the new fields.
4. **`nook-app/nook-platform/nook-core` tests** — round-trip and validation tests (authority for payload behavior).
5. **`nook-app/nook-web`** — add-secret form fields + `SecretDetailRow` rendering only. **No** new TS struct mirror or `parseVaultItem` arm.
6. **Playwright** — e2e for the new form if user-visible.

## 6. Testing
- Test vault formats, crypto, validation, and passwords in `nook-core`.
- **Coverage gate:** `task rust:coverage:check` (llvm-cov + nextest, **90%** line floor in `nook-app/nook-platform/nook-core/coverage-floor.json`). Part of `task check` / CI. Below 90%, add Rust tests.
- **Fast tests:** `task rust:test` (nextest only, no coverage instrumentation).
- Use Playwright e2e for UI flows; do not duplicate domain rules in TypeScript tests.
