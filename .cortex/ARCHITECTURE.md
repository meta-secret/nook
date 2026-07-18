# Nook System Architecture Specification

This document provides a comprehensive guide to Nook's architecture, package boundaries, data flows, and development environments. It serves as the primary technical context map for both human developers and autonomous AI coding agents.

---

## 1. Monorepo Structure & Dependency flow

Nook is built as a modular monorepo using a strict, uni-directional dependency flow. App code lives under the root `nook-app/` directory, which contains the Rust core, WASM bridge, web app, browser-extension package, and Docker build definitions for the split Rust/WASM and web images. This prevents architectural drift, guarantees separation of concerns, and isolates WebAssembly bindings from core domain code.

```
root/
├── Taskfile.yml          (repo entrypoint; includes app tasks + root tooling)
├── preflight/            (standalone Rust tests for whole-repository invariants)
│   ├── Taskfile.yml      (`task preflight` Docker entrypoint)
│   ├── Dockerfile
│   └── tests/
├── .task/
│   └── agentic-ai.yml    (repo-level agent tooling)
└── nook-app/
    ├── Taskfile.yml      (app command surface)
    ├── .task/            (cross-package app and CI task includes)
    ├── docker/
    │   └── Taskfile.yml  (Docker orchestration task include)
    ├── .task/            (app build/check/dev task fragments)
    ├── Cargo.toml
    ├── Cargo.lock
    ├── docker-bake.hcl
    ├── .cargo/
    ├── .config/
    ├── docker/              (shared app/toolchain image definitions)
    ├── nook-auth2/
    ├── nook-core/
    ├── nook-wasm/
    ├── nook-web/
    │   ├── Taskfile.yml  (web-family task include)
    │   ├── .task/        (web, extension, and wasm task includes)
    │   ├── nook-web-app/
    │   ├── nook-vault-simple/
    │   ├── nook-vault-sentinel/
    │   ├── nook-web-extension/
    │   └── nook-web-shared/
+-------------------------------------------------------------+
|      nook-vault-simple       |      nook-vault-sentinel     |
|  (independent Simple app)    |  (independent Sentinel app)  |
+-------------------------------------------------------------+
|                    nook-web-app (site)                      |
+-------------------------------------------------------------+
|                    nook-web-extension                       |
|       (Manifest V3 extension UI, service worker, scripts)   |
+-------------------------------------------------------------+
|                      nook-web-shared                        |
|        (Source-only TS/Svelte shared presentation glue)      |
+-------------------------------------------------------------+
                               |
                               v (consumes generated bindings)
+-------------------------------------------------------------+
|                         nook-wasm                           |
|       (Rust-Wasm Bridge: I/O, session, wasm-bindgen)        |
+-------------------------------------------------------------+
                               |
                               v (core domain dependencies)
+-------------------------------------------------------------+
|                         nook-core                           |
|   (Rust domain: vault formats, events, sync, secrets)        |
+-------------------------------------------------------------+
                               |
                               v (portable security/key access)
+-------------------------------------------------------------+
|                         nook-auth2                           |
|     (Rust auth: device identity, envelopes, vault keys)      |
+-------------------------------------------------------------+
```

### Dependency Enforcements

1. **No Circular Dependencies:** `nook-core` must not depend on `nook-wasm` or `nook-web`. `nook-wasm` must not depend on `nook-web`.
2. **Platform Portability:** `nook-auth2` and `nook-core` compile on native and `wasm32-unknown-unknown`. No browser APIs in either crate; simple domain DTOs/enums may carry `wasm-bindgen` annotations so web callers use the same typed core models.

---

## 2. Package Responsibilities & Layers

### A. `nook-auth2` (Portable Vault Security / Key Access)

- **Device identities:** X25519 identity generation, device fingerprints, auth ids, and age envelopes.
- **Device-key protection:** Passkey PRF result validation plus HKDF/AES-GCM wrapping for the browser-persisted identity. Browser/WebAuthn ceremonies stay outside this crate.
- **Credential envelopes:** `auth:` rows, `password_entries`, enrollment payloads, member roster encryption, and key-resolution helpers for `secrets_key` and `members_key`.
- **Quorum recovery:** Fixed-policy SLIP-0039 recovery roots, protected per-device shares, and recovery-envelope helpers for `secrets_key` and `members_key` live here; recovery request/response exchange state stays out of sync providers.
- **Key material and row types:** Portable newtypes for vault key material, auth/member ids, age-armored ciphertext, signing public keys, and the opaque `StoredSecretRecord` row shape shared by user secrets and auth metadata.
- **No provider I/O:** No GitHub, Drive, iCloud, IndexedDB, OAuth, PAT, browser APIs, or sync reconciliation. Sync provider credentials authorize replica access only; they are not vault unlock credentials.
- **Portability:** Compiles on native and `wasm32-unknown-unknown` so browser, extension, CLI, server, mobile, HSM, YubiKey, and future quorum-recovery adapters can share the same key-access semantics.

### B. `nook-core` (The Domain Core)

- **`src/auth/`:** Compatibility re-exports for `nook-auth2` plus the core-only adapter that replays vault event operations into auth metadata state.
- **`src/crypto/`:** Canonical event signing/hashing, vault encryption, key-epoch re-encryption, and signing identity helpers.
- **`src/secrets/`:** Secret payload types/views, mnemonic helpers, password generation, and plaintext session mutation helpers.
- **`src/sync/`:** Storage-provider validation/configuration, credential sealing, provider snapshot migration, and vault reconciliation.
- **`src/vault/`:** In-memory database, vault formats, ids/newtypes, event log, projection, import, connect, session-cache workflows, typed access states, and portable idle/sync runtime policy.
- **Application services:** Provider-agnostic connect decisions live in
  `vault_connect`; unlock/session hydration in `vault_session` and
  `vault_session_cache`; enrollment in `auth/enrollment`; mutation/event
  orchestration in `vault_event_builder` and `vault_event_session`; and sync
  reconciliation in `vault_sync_session` and `vault_sync_store`. Hosts load or
  persist bytes, tokens, revisions, and timestamps, then call these services;
  they do not repeat their decisions.
- **Host boundary:** `LocalEventStore` and `MemoryVaultStore` are portable
  in-memory service inputs. Browser event storage, projection cache, clocks,
  secure randomness ceremonies, and provider transports remain adapters in
  `nook-wasm`; portable functions receive their resulting typed data explicitly.
- **Root exports:** `nook-app/nook-core/src/lib.rs` keeps the public `nook_core::...` API stable and exposes private compatibility aliases for older internal `crate::vault_event`-style paths. New files should live under the domain group, not directly under `src/`.
- **Tests:** Unit tests in each module + `tests/vault_workflow.rs` + `tests/multi_device_workflow.rs`.

### C. `nook-wasm` (The Bridge Layer)

- **`NookVaultManager`:** Session state — typed `Database`, vault metadata, `secrets_key`, `members_key`, `VaultCrypto`, device identity, GitHub SHA.
- **Storage I/O:** IndexedDB (`rexie`), GitHub REST API (`reqwest`).
- **Device protection:** Persist/migrate the wrapped identity, build WebAuthn PRF option payloads with `1Password/passkey-rs` `passkey-types`, and expose typed setup/unlock values to the web layer. Delegates portable key wrapping and auth metadata behavior to `nook-auth2` through `nook-core`.
- **Exported methods:** `connect`, `add_secret`, `approve_join_request`, `enroll_and_connect(secrets_key, members_key)`, etc.
- **No domain logic** that belongs in `nook-core` — validate/delegate/serialize via core.
- **Runtime wrappers:** Runtime policy, architecture, secret forms, diagnostics,
  Sentinel session/finalization state, sync conflicts, and recovery issues are
  core-owned values exposed through typed wrappers. WASM does not own timeout
  rules, domain DTO mirrors, or string status taxonomies.

### D. Isolated vault applications (The Web Presentation Layer)

- **`nook-vault-simple`:** fixed Simple capability, Simple-only local registry,
  create/import/open/manage flows, and the extension-consent route.
- **`nook-vault-sentinel`:** fixed Sentinel capability, Sentinel-only local
  registry, genesis/quorum/import/open/manage flows, no extension route or
  protocol UI, and Rust-rejected extension approval.
- **`nook-web-app`:** public `nokey.sh` site and unified local/e2e harness. It
  is not a universal production vault artifact; the public production build
  contains no vault entrypoint.
- **Origin boundary:** each production app uses its own origin-scoped IndexedDB,
  WebAuthn RP ID (`simple.nokey.sh` or `sentinel.nokey.sh`), session state,
  security headers, and Cloudflare Pages project. Before app modules load, its
  entrypoint configures an immutable Rust/WASM `VaultApplication` identity that
  every manager uses for fail-closed capability checks.

- **Svelte 5 components:** Shared layout and forms are consumed by separate
  project entrypoints; TypeScript visibility never authorizes a vault type.
- **`VaultState` (`vault.svelte.ts`):** Reactive shell — calls WASM, holds
  metadata-only `NookSecretListItem` pages for reactivity, and requests one
  `NookSecretRecord` only for reveal/secret-copy.
- **`auth-providers.ts`:** IndexedDB persistence for storage/sync providers — see [auth-providers.md](design-docs/auth-providers.md) (migrating to [unified-vault.md](design-docs/unified-vault.md)).
- **`passkey-device-protection.ts`:** Thin browser-only WebAuthn create/get adapter. Rust/WASM builds the PRF option payloads; TypeScript invokes `navigator.credentials`, extracts the returned PRF output, and performs no encryption. `nook-wasm/src/passkey_browser.rs` classifies WebAuthn `NotAllowedError` as the stable `PASSKEY_CEREMONY_NOT_ALLOWED` result because the browser intentionally uses it for cancellation, timeout, policy refusal, and unavailable credentials. UI callers localize that ambiguity for create, recovery, and unlock flows; they must not infer PRF absence or offer the PIN fallback unless the browser returns the distinct PRF-unavailable result.
- **`DeviceProtectionGate`:** Mandatory passkey setup/unlock before provider credentials or device keys are loaded.
- **`LoginGate`:** Login when vault is locked — create local vault, connect sync provider, or unlock existing cache; see [vault-session-and-lock.md](design-docs/vault-session-and-lock.md).
- **`VaultState.lockVault()`:** Clears WASM session + Svelte secrets; header **Lock vault** button.
- **`nook.ts`:** WASM loader + sync result mapping; vault list rows are
  `NookSecretListItem` wasm objects and explicit plaintext exposure uses
  `NookSecretRecord` (no TS schema mirror).
- **No** vault format logic, crypto, validation, password generation, or search filtering in TS/Svelte.

### D2. `nook-web/nook-web-shared` (Shared TypeScript/Svelte Source)

- **Source-only package:** Shared TypeScript helpers and small Svelte presentation
  primitives that are safe for the two vault apps and the browser extension.
- **No ownership of domain policy:** Shared TS/Svelte code may coordinate UI,
  browser-page scanning, message DTOs, or wrapper helpers around WASM exports,
  but it must not own vault format logic, crypto, validation, password
  generation, or secret search. Those remain in `nook-core` and are exposed
  through `nook-wasm`.
- **One generated WASM package:** `nook-wasm` is compiled and optimized once into
  `nook-web-shared/src/vault-app/lib/nook-wasm`. Unified, Simple, Sentinel, and
  extension bootstraps configure distinct immutable Rust application
  identities before importing their app modules. Separate web
  projects and origins remain the product boundary; manager construction and
  domain operations validate the configured identity in Rust. Sentinel's built
  web surface contains no extension route, protocol, or UI, and Rust rejects
  extension approval for its identity even though the shared binding exists for
  Simple and the browser companion.

### E. `nook-web/nook-web-extension` (The Browser Extension Layer)

- **Manifest V3 package:** Browser extension build output lives in `nook-app/nook-web/nook-web-extension/dist`; source lives under `nook-app/nook-web/nook-web-extension/src`.
- **Simple Vault owns the vault UI:** Before pairing, the toolbar popup contains
  only the standard extension-origin device-protection widget. Creating,
  recovering, or unlocking that identity sends its public keys directly to the
  environment-configured Simple Vault consent route. The extension contains no
  duplicate vault-management popup, website-first enable page, or second setup
  window. Its other visible surface is the contextual in-page authentication
  widget.
- **Environment target:** `NOOK_SIMPLE_VAULT_URL` is sealed into the extension
  bundle and manifest. Production uses `simple.nokey.sh`, development uses
  `simple.dev.nokey.sh`, PR previews use their isolated
  `pr-<number>.nokey-simple.pages.dev` origin, and local development uses
  trusted HTTPS localhost. Each channel has a distinct deterministic extension
  id so extension-origin state and passkeys cannot cross environments.
- **Deployment artifacts:** The sealed image packages the exact tested bundle
  into the site artifact's `/downloads/` directory with `extension.json`
  metadata and a SHA-256 checksum. PR and main workflows publish and verify the
  preview/development ZIP; immutable releases publish the versioned production
  ZIP through both `nokey.sh` and the GitHub Release.
- **Simple-only product surface:** The service worker, content scripts, and
  future autofill flows pair only through `simple.nokey.sh`. The manifest and
  runtime guard exclude both Nook vault origins from widget injection, and Rust
  rejects Sentinel extension approval.
- **Task/Docker integration:** `task extension:build` builds the extension in Docker; `task extension:test:e2e` runs the extension Playwright smoke; the sealed `nook-web:local` image also builds `nook-app/nook-web/nook-web-extension/dist` at image time. Use `task docker:extract:extension` to copy the built bundle to the host for manual browser loading. `task extension:install:hosted` and the hosted `extension:run:*` variants verify deployment metadata and SHA-256, activate an immutable release atomically, and launch it only in a channel-specific isolated browser profile.
- **Domain boundary:** The extension may consume WASM/domain APIs through explicit bridge modules when needed, but must not reimplement vault format logic, crypto, validation, password generation, or search filtering in TypeScript.
- **Local projection bridge:** Simple Vault publishes its canonical encrypted,
  signed event log after local mutations and provider pulls. A content script
  restricted to the configured Simple origin transports that snapshot to the
  service worker; Rust/WASM validates canonical ids/signatures, store identity,
  the extension's protected device id, current approval, and revocation before
  persisting an extension-origin IndexedDB projection. `chrome.storage.local`
  contains connection metadata only. Sync providers complement this bridge for
  changes originating on other devices; they are not required for same-browser
  website/extension coherence.

### F. `nook-web/nook-web-research` (Isolated UI Experiments)

- **Independent research surface:** A small Svelte 5 + Vite catalog for disposable UI experiments. Each experiment lives in its own directory under `src/experiments/` and is registered in the catalog.
- **No production coupling:** It does not import production Nook code or WASM and is not part of the Docker, CI, deploy, or production web build. Run it directly with Bun from its package directory.

---

## 3. Detailed Data Flow & Execution Model

### Connect (multi-device)

```
[Svelte] → WASM-built passkey options → navigator.credentials.get()
         → NookVaultManager.unlockDeviceIdentity(prf_output)
              → HKDF-SHA256 → AES-256-GCM unwrap of device identity
         → VaultState.loadDb()
         → NookVaultManager.connect(mode, pat)
              → use authorized device identity (memory)
              → load local projection or remote event log
              → resolve_secrets_key() + resolve_members_key() from auth row
              → VaultCrypto::new(secrets_key)
              → decrypt user secret values → typed Database session
```

### Add Secret (incremental save)

```text
[Svelte] → add_secret(key, value)
         → validate_secret_label, validate_secret_value
         → update typed Database session
         → encrypt_value ONLY for this key → stored_armored
         → serialize_stored(Yaml) from cache (no full re-encrypt)
         → write vault:{store_id} / append provider events
```

### Search

```
[Svelte] → filter_secrets(query)  [sync WASM call]
         → nook-core::filter_secrets on session records
         → UI re-renders via secretsCount reactivity trigger
```

---

## 4. Storage & Cryptographic Specs

| Layer                                  | Format                                                        | Location                                                                                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Session (plaintext user secrets)       | Typed `Database` records                                      | WASM memory only                                                                                                                                                               |
| On-disk user secrets                   | YAML `secrets:` list                                          | Values encrypted with `secrets_key`                                                                                                                                            |
| Logical secret store                   | YAML `store_id`                                               | `store_{token}` — same across provider replicas ([secret-store-identity.md](design-docs/secret-store-identity.md))                                                             |
| Vault revision                         | YAML `vault_version`                                          | Monotonic counter; incremented on every save ([unified-vault.md](design-docs/unified-vault.md))                                                                                |
| Active unlock mode                     | YAML `unlock:` tagged union (omitted when keys — the default) | `{type: password, …}` for password-only vaults; device-key vaults use `auth:` (+ optional `password_entries`). See [password-envelope.md](product-specs/password-envelope.md). |
| On-disk key envelopes (keys mode only) | YAML `auth:` list                                             | `key_{sha256}` → age-armored `secrets_key` + `members_key`                                                                                                                     |
| Member catalog                         | YAML `members:` list                                          | `pk_id` + `members_key`-encrypted `{pk_id, pk}`                                                                                                                                |
| Pending joins (keys mode only)         | YAML `joins:` list                                            | `device_id` → JSON (includes `public_key` while pending)                                                                                                                       |
| Device identity (X25519 private)       | AES-256-GCM wrapped age secret + WebAuthn PRF or PIN metadata  | IndexedDB `device_identity_wrapped`; legacy `device_identity_secret` exists only until one-time migration                                                                      |
| Auth providers (GitHub PAT, labels)    | JSON snapshot                                                 | IndexedDB `nook_auth` → `providers` key                                                                                                                                        |

See [vault-session-and-lock.md](design-docs/vault-session-and-lock.md) for Lock vs persisted data.
See [decentralized-auth.md](product-specs/decentralized-auth.md) for join/approve flows.
See [auth-providers.md](design-docs/auth-providers.md) for login UX and sync provider roadmap.
See [unified-vault.md](design-docs/unified-vault.md) for local-first vault architecture and version sync.

```
secrets:  user passwords (secrets_key)
auth:     per-device secrets_key + members_key envelopes
joins:    transient join requests
members:  members_key-encrypted catalog entries
```

- **Per-record age armor** for values; labels plaintext in YAML.
- **GitHub:** UTF-8 YAML file, base64 in API payloads (not hex blob).
- **IndexedDB `vault:{store_id}`:** UTF-8 YAML projection cache (not hex).

---

## 5. Boundary Error Propagation Model

- All fallible WASM exports return `Result<T, wasm_bindgen::JsError>`.
- `NookError` maps to JS `Error` with message string.
- Svelte catches in `try/catch` on `VaultState` methods.

---

## 6. Testing Strategy

| Package     | Tests                                                                                                                                                                                                    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preflight` | `task preflight` — standalone Rust tests for whole-repository invariants; runs before app setup in PR/main CI                                                                                            |
| `nook-core` / `nook-auth2` | `task rust:coverage:check` — llvm-cov + nextest with **line coverage floor** (`nook-app/nook-core/coverage-floor.json`); fast path `task rust:test`                                                               |
| `nook-web/nook-web-app`  | Playwright e2e: `task web:test:e2e` (main stub gate and explicit PR validation), `task web:test:e2e:pr` (fast manual subset), `task web:test:e2e:sync-live` (nightly); see [workflows/ci-pipeline.md](workflows/ci-pipeline.md) |
| `nook-wasm` | Covered via `nook-core` + e2e; no separate domain tests required                                                                                                                                         |
| `nook-web/nook-web-extension` | `task extension:check` for type/build validation; `task extension:test:e2e` for the Chromium extension smoke loaded from the packaged `dist` bundle |

Domain logic changes **must** add or update Rust tests before merge. **Line coverage must stay at or above 90%** (`task rust:coverage:check`).

---

## 7. The Engineering Harness

All development tasks run containerized via `Taskfile`. The root `Taskfile.yml` is the repo entrypoint; app-specific commands live in `nook-app/Taskfile.yml` and are included into the root command surface. Cross-package app/CI tasks stay under `nook-app/.task/`, Docker orchestration lives in `nook-app/docker/Taskfile.yml`, and web-family commands are owned by `nook-app/nook-web/Taskfile.yml` with local includes under `nook-app/nook-web/.task/`. The workspace **source is copied into the nook-web image** at build time (`nook-app/nook-web/nook-web-app/Dockerfile`) — there is **no runtime bind mount** on the common path, so the image is self-contained and reproducible. The explicit local-iteration exceptions are `task web:dev` / `task web:dev:fast` (Vite hot-reload over trusted `https://localhost:<port>` using ignored TLS material in `.nook/https/`) and `task wasm:build:fast` (mounted no-opt WASM regeneration). `task web:https:setup` builds and runs the pinned repository `mkcert` container; only the final CA trust operation runs on the host because the browser consumes the host trust store. Playwright and CI keep their isolated loopback-HTTP transport when real passkey/OAuth/provider ceremonies are not under test.

PR delivery helpers live in `agentic-ai/ci-agent` and are exposed as `task
pr:preflight`, `task pr:review`, and `task pr:ready`. The review command posts an
idempotent SHA-bound Codex request; the audit commands emit machine-readable
exact-head state, including review settlement, and never merge a PR. Nook has no event-driven
PR auto-merger: workflows do not merge blindly from check events. Instead, the
task-owning agent runs the readiness audit and squash-merges immediately when it
passes. Extension
iteration has a host-cached `task extension:check:fast` gate, while required
full local validation still begins after the coherent iteration is pushed and
runs in parallel with repository CI.

### Split Rust/WASM and web images

- **Rust/WASM lineage**: `rust-base` + manifest-only chef cooking exposes a lightweight WASM dependency boundary, while native verification extends it with nextest/clippy/coverage profiles. Hosted PR CI runs native coverage independently, while WASM clippy/build/Node tests continue into web verification on the same second runner. Multi-GB source-sensitive `target/` snapshots stay local to each solve; hosted CI persists the toolchain and stable native/WASM dependency boundaries in `nook-rust-base-v1`, `nook-rust-deps-v2`, and `nook-rust-wasm-deps-v1`. Explicit `task rust:*` / `task wasm:*` commands load the source-sealed `nook-rust:local` image on demand; browser-only WASM tests and mounted Vite development use `nook-rust-browser:local`.
- **Web lineage**: `web-base` contains Bun, Node, and Task; `web-deps` adds `node_modules`. PR unit/preview builds use this browser-free lineage. `web-e2e-base` adds Playwright Chromium only for main/nightly/manual e2e and uses a separate `:web-e2e-*` cache, so PR cache imports never pull the browser layer. Neither lineage contains Cargo or `target/`.
- **Common task image** (`nook-web:local`): starts from `web-base`, adds `node_modules`, the generated WASM package, coverage artifacts, workspace source, and built web/extension output. This is the slim image used by normal Task and CI runtime checks.

`task setup` has two solves. The first builds web dependencies alongside a Rust graph that fans out from cached dependencies into native verification and WASM, then exports the scratch `web-artifacts` join under `${TMPDIR}/nook-web-artifacts/<full-commit-sha>/<unique-invocation>/`. The commit namespace isolates different revisions, and the invocation namespace prevents concurrent builds of the same revision from racing. That directory contains only generated WASM and coverage files and is guarded at 256 MiB. The second solve supplies it as a named host context to `nook-web`; it never passes either multi-GB Rust branch as a Docker context or parent. The final Dockerfile also asserts that `/usr/local/cargo` and `nook-app/target` are absent.

Nook runtime containers set `nofile=1048576`; `DOCKER_NOFILE_LIMIT` can
override that value. Inotify sysctls are kernel-wide and Docker rejects them as
per-container `--sysctl` options, so Linux developers configure the documented
host prerequisites: at least `fs.inotify.max_user_instances=2500` and
`fs.inotify.max_user_watches=10485760`. The shared GitHub Actions Docker setup
raises those values when needed without lowering larger runner defaults. On
macOS, those sysctls live inside Docker Desktop's Linux VM and must be applied
with the documented short-lived privileged container after Docker Desktop
restarts; macOS `sudo sysctl` does not configure the VM. The separate macOS
host-wide file-descriptor ceilings are `kern.maxfiles` and
`kern.maxfilesperproc`, with launchd's `maxfiles` controlling newly launched
processes; the README documents the current-host 10x values.

### Build export: host artifact boundary + docker driver

The old combined `nook-web` filesystem was about 9 GB because it inherited warm Rust `target/`, the compiler, Cargo registry, web dependencies, and Playwright. The split keeps those caches in independent BuildKit lineages. Only the WASM package and coverage outputs cross from Rust to web through the commit-scoped, invocation-isolated host directory, and the common runtime image contains no Rust toolchain or `target/`. The normal **`docker` driver** builder writes the web result directly to the containerd image store, avoiding an extra archive/import cycle. Hosted delivery validation uses an ephemeral `docker-container` builder and restores the independent lineages from GitHub's cache service.

- **Builder selection:** normal local `task setup` callers pass the active Docker-context builder (`desktop-linux` on Docker Desktop or `default` on plain Linux). GitHub Actions creates an ephemeral `docker-container` builder with `docker/setup-buildx-action` and passes its name through the existing bounded health wrapper before repository preflight and app solve phases begin.
- **CI parity:** `.github/actions/nook-docker-setup` raises Linux watcher limits, creates and exports the hosted `docker-container` Buildx builder for both wrapped and direct Task callers, exposes the Actions cache-service runtime, and enables the Bake GHA scopes. Delivery does not depend on the daemon's default image store and never rewrites daemon configuration or restarts Docker.
- **BuildKit caching crosses hosted VMs through GHA only:** local commands keep using the selected builder's local content store with `GHA_CACHE_ENABLED` empty. Hosted CI first stabilizes the shared Rust toolchain parent in `nook-rust-base-v1`, then exports native and WASM dependency boundaries to `nook-rust-deps-v2` and `nook-rust-wasm-deps-v1` with `mode=max`. The explicit base scope is required: rebuilding apt/tool installers on each ephemeral VM changes the parent snapshot and invalidates otherwise reusable cargo-chef/profile layers. Source branches run on separate runners and are deliberately not exported because transferring their multi-GB snapshots is slower than executing them. Web dependencies, browser-free web, and e2e web use distinct scopes and `mode=max`. Cache export errors are non-fatal because cache is an optimization. Registry cache manifests remain forbidden.
- **Rust compiler fallback cache:** every Rust/WASM compile is wrapped by pinned `sccache`. Task idempotently keeps one Docker-host-only Redis container running per Docker host; short-lived sccache daemons use per-container Unix sockets and share only that Redis storage. The endpoint is always `host.docker.internal:${SCCACHE_REDIS_PORT:-6380}` inside build/runtime containers. `nook-app/docker/resolve-docker-host-ip.sh` resolves a numeric Docker-host IPv4 address and Task passes it to Bake and every Rust-capable runtime container; no magic gateway token is used. Redis publishes only on `127.0.0.1` under Docker Desktop and only on the default Docker bridge gateway under Linux Engine, never on `0.0.0.0`. Redis uses an AOF-backed named volume, an 8 GiB default memory ceiling, and `allkeys-lru`; `SCCACHE_REDIS_MAXMEMORY` overrides the ceiling. This cache survives Docker-layer invalidation and dependency graph changes, but compiler version, target, profile, flags, coverage instrumentation, and non-cacheable link outputs still produce misses.

**Main seeds cache visibility.** GitHub lets PR workflows restore caches from their own branch and the default branch, so main refreshes the shared scopes and PR pushes refresh their branch-local copies. Retired registry manifests, commit images, cache-publish groups, and GHCR login plumbing must not return.

Docker bake orchestration is app-owned: `nook-app/Taskfile.yml` passes `nook-app/docker-bake.hcl` plus package-local bake files under `nook-app/**/docker-bake.hcl` to `docker buildx bake`, while the root `Taskfile.yml` includes those app commands for repo-root usage. The Taskfile passes bake files as absolute paths, grants buildx read access to the repo root, and sets every source target context to the repo root so local and hosted-runner buildx versions resolve paths the same way. During the host handoff it grants write access only to the current commit/invocation artifact directory, then read access only to that directory for the web solve. The main Docker build context remains the repository root, so the sealed app image can copy root workflow files (`Taskfile.yml`, `.task/agentic-ai.yml`, docs, and CI helper scripts) as well as `nook-app`.

### Docker cache model

Nook does not use named volumes for `target/`, Cargo registries, or
`node_modules`: those correctness-relevant build inputs stay in normal image
layers and the selected builder's local content store. The sole cache-service
exception is the optional `nook-sccache-redis` volume. It persists compiler
objects on stateful local/self-hosted Docker engines; a fresh GitHub-hosted
engine simply starts empty, without affecting correctness.

| What                    | How it is cached                                                                                                                                                                                                                                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rust/web/browser layers | Local commands reuse the selected builder's store. Hosted CI persists stable Rust dependencies plus separate web-dependency, browser-free-web, and e2e-web GHA v2 scopes; source-heavy native/WASM snapshots are not transferred, and no registry cache is used. |
| Rust crate dependencies | **cargo-chef** release WASM cooks plus manifest-keyed dummy-root warm-ups for native nextest/clippy/coverage and the debug/test WASM artifacts consumed by `wasm-pack test --node`. The chef planner and warm-up layers copy only `Cargo.toml`/`Cargo.lock` plus dummy crate roots, so ordinary Rust source edits do not recompile the dependency graphs. When those exact layers miss, Redis-backed `sccache` reuses compatible crate compiler outputs across builds on the same Docker host. |
| Redis compiler cache | `task sccache:ensure` creates or starts `nook-sccache-redis` with restart policy, Docker-host-only port publication (macOS loopback / Linux bridge gateway), AOF persistence, an 8 GiB default ceiling, and LRU eviction. `task sccache:stats` reports keys, memory, hits, misses, and evictions. The running service and its attached volume are not removed by routine Docker prune. |
| `nook-app/target/`      | Lives at `/meta-secret/nook/nook-app/target` in the Rust lineage only. Hosted CI persists its reachable BuildKit layers in the Rust GHA scope; it remains absent from `nook-web:local`. |
| `nook-app/nook-web/nook-web-app/node_modules` | Installed directly in the `web-deps` Dockerfile layer (parallel branch, local immutable layer like `builder-deps`), with no host/daemon cache mount. `web:dev` (mounted) runs `bun install` in its command. |
| Web wasm pkg + coverage | Generated in `builder-wasm`, exported from a scratch target under `${TMPDIR}/nook-web-artifacts/<commit>/<invocation>/`, then consumed as a small named context by the web solve. |
| Web dist                | Built at **nook-web image build time** (`bun run build`, channel URL args) so it is present in every container: PR previews deploy the combined internal harness plus three isolated native Pages aliases, main deploys isolated site/Simple/Sentinel artifacts to their stable development origins, and release publishes the extracted production artifacts. |
| Playwright Chromium     | Pre-installed only in `web-e2e-base`; absent from PR `web-base` and the normal Rust lineage. Browser-only WASM tasks use the on-demand Rust browser image. |
| CI Docker builds        | **`task ci:pr`** (PR verify/build without browser e2e, then internal-harness plus isolated Cloudflare aliases and a `github-pages` deployment status) / **`task ci:main`** (full browser e2e and isolated Cloudflare deploys for `dev.nokey.sh`, `simple.dev.nokey.sh`, and `sentinel.dev.nokey.sh`). Main also publishes commit-keyed Rust coverage; PRs reuse it, with `task docker:coverage:export` as a coverage-only fallback. |

Regenerate chef inputs after dependency changes: commit **`nook-app/Cargo.lock`** when dependencies change; `recipe.json` is produced during `docker build`.

### Sealed-image consequences

- **Write-type tasks emit diffs, not host writes.** Web formatting runs in `nook-web:local`; Rust formatting and coverage updates run in `nook-rust:local`. Both source-sealed images print a `git diff` for application on the host.
- **`dist` hand-off.** PR CI keeps the combined `dist` tree as an internal harness and independently deploys `dist/site`, Simple, and Sentinel to each project's `pr-<number>` branch alias; its GitHub deployment points at the isolated site. Main deploys the same artifacts independently, with the landing and both vault domains targeting their projects' `development` branch aliases. Release extracts production artifacts with `task docker:extract:dist`.

### Build & verify

- **Native linking:** `nook-app/.cargo/config.toml` uses **mold** for `x86_64-unknown-linux-gnu` only (installed in `rust-base`); wasm32 targets keep the default linker.
- **Wasm:** `builder-wasm` compiles the featureless `nook-wasm` bridge and runs `wasm-pack` exactly once. Unified, Simple, Sentinel, and extension consumers share that generated package; immutable Rust-owned application configuration and manager capability checks enforce the active realm. The package crosses the host artifact boundary and is seeded into the web image. Mounted local-iteration paths regenerate it from the on-demand Rust image. `WASM_BUILD_MODE=dev` is the default and skips `wasm-opt`; PR/main CI use dev mode, while release passes `WASM_BUILD_MODE=prod` explicitly.
- **Verify:** `task check` (fmt, clippy, `task rust:coverage:check`, svelte-check, eslint, vitest, vite build) using the default dev/no-opt WASM mode unless `WASM_BUILD_MODE=prod` is set.
