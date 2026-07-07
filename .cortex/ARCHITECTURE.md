# Nook System Architecture Specification

This document provides a comprehensive guide to Nook's architecture, package boundaries, data flows, and development environments. It serves as the primary technical context map for both human developers and autonomous AI coding agents.

---

## 1. Monorepo Structure & Dependency flow

Nook is built as a modular monorepo using a strict, uni-directional dependency flow. App code lives under the root `nook-app/` directory, which contains the Rust core, WASM bridge, web app, browser-extension package, and Docker build definitions for the app/toolchain images. This prevents architectural drift, guarantees separation of concerns, and isolates WebAssembly bindings from core domain code.

```
root/
├── Taskfile.yml          (repo entrypoint; includes app tasks + root tooling)
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
    ├── nook-auth/
    ├── nook-core/
    ├── nook-wasm/
    ├── nook-web/
    │   ├── Taskfile.yml  (web-family task include)
    │   ├── .task/        (web, extension, and wasm task includes)
    │   ├── nook-web-app/
    │   ├── nook-web-extension/
    │   └── nook-web-shared/
+-------------------------------------------------------------+
|                      nook-web-app                           |
|             (Vite + Svelte 5 + TypeScript UI)               |
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
|                         nook-auth                           |
|     (Rust auth: device identity, envelopes, vault keys)      |
+-------------------------------------------------------------+
```

### Dependency Enforcements

1. **No Circular Dependencies:** `nook-core` must not depend on `nook-wasm` or `nook-web`. `nook-wasm` must not depend on `nook-web`.
2. **Platform Portability:** `nook-auth` and `nook-core` compile on native and `wasm32-unknown-unknown`. No browser APIs in either crate; simple domain DTOs/enums may carry `wasm-bindgen` annotations so web callers use the same typed core models.

---

## 2. Package Responsibilities & Layers

### A. `nook-auth` (Portable Vault Security / Key Access)

- **Device identities:** X25519 identity generation, device fingerprints, auth ids, and age envelopes.
- **Device-key protection:** Passkey PRF result validation plus HKDF/AES-GCM wrapping for the browser-persisted identity. Browser/WebAuthn ceremonies stay outside this crate.
- **Credential envelopes:** `auth:` rows, `password_entries`, enrollment payloads, member roster encryption, and key-resolution helpers for `secrets_key` and `members_key`.
- **Key material and row types:** Portable newtypes for vault key material, auth/member ids, age-armored ciphertext, signing public keys, and the opaque `StoredSecretRecord` row shape shared by user secrets and auth metadata.
- **No provider I/O:** No GitHub, Drive, iCloud, IndexedDB, OAuth, PAT, browser APIs, or sync reconciliation. Sync provider credentials authorize replica access only; they are not vault unlock credentials.
- **Portability:** Compiles on native and `wasm32-unknown-unknown` so browser, extension, CLI, server, mobile, HSM, YubiKey, and future quorum-recovery adapters can share the same key-access semantics.

### B. `nook-core` (The Domain Core)

- **`src/auth/`:** Compatibility re-exports for `nook-auth` plus the core-only adapter that replays vault event operations into auth metadata state.
- **`src/crypto/`:** Canonical event signing/hashing, vault encryption, key-epoch re-encryption, and signing identity helpers.
- **`src/secrets/`:** Secret payload types/views, mnemonic helpers, password generation, and plaintext session mutation helpers.
- **`src/sync/`:** Storage-provider validation/configuration, credential sealing, provider snapshot migration, and vault reconciliation.
- **`src/vault/`:** In-memory database, vault formats, ids/newtypes, event log, projection, import, connect, and session-cache workflows.
- **Root exports:** `nook-app/nook-core/src/lib.rs` keeps the public `nook_core::...` API stable and exposes private compatibility aliases for older internal `crate::vault_event`-style paths. New files should live under the domain group, not directly under `src/`.
- **Tests:** Unit tests in each module + `tests/vault_workflow.rs` + `tests/multi_device_workflow.rs`.

### C. `nook-wasm` (The Bridge Layer)

- **`NookVaultManager`:** Session state — typed `Database`, vault metadata, `secrets_key`, `members_key`, `VaultCrypto`, device identity, GitHub SHA.
- **Storage I/O:** IndexedDB (`rexie`), GitHub REST API (`reqwest`).
- **Device protection:** Persist/migrate the wrapped identity, build WebAuthn PRF option payloads with `1Password/passkey-rs` `passkey-types`, and expose typed setup/unlock values to the web layer. Delegates portable key wrapping and auth metadata behavior to `nook-auth` through `nook-core`.
- **Exported methods:** `connect`, `add_secret`, `approve_join_request`, `enroll_and_connect(secrets_key, members_key)`, etc.
- **No domain logic** that belongs in `nook-core` — validate/delegate/serialize via core.

### D. `nook-web/nook-web-app` (The Web Presentation Layer)

- **Svelte 5 components:** Layout, forms, vault list UI.
- **`VaultState` (`vault.svelte.ts`):** Reactive shell — calls WASM, holds `secrets` for reactivity, auth provider state.
- **`auth-providers.ts`:** IndexedDB persistence for storage/sync providers — see [auth-providers.md](design-docs/auth-providers.md) (migrating to [unified-vault.md](design-docs/unified-vault.md)).
- **`passkey-device-protection.ts`:** Thin browser-only WebAuthn create/get adapter. Rust/WASM builds the PRF option payloads; TypeScript invokes `navigator.credentials`, extracts the returned PRF output, and performs no encryption.
- **`DeviceProtectionGate`:** Mandatory passkey setup/unlock before provider credentials or device keys are loaded.
- **`LoginGate`:** Login when vault is locked — create local vault, connect sync provider, or unlock existing cache; see [vault-session-and-lock.md](design-docs/vault-session-and-lock.md).
- **`VaultState.lockVault()`:** Clears WASM session + Svelte secrets; header **Lock vault** button.
- **`nook.ts`:** WASM loader + sync result mapping; vault secrets are `NookSecretRecord` wasm objects (no TS schema mirror).
- **No** vault format logic, crypto, validation, password generation, or search filtering in TS/Svelte.

### D2. `nook-web/nook-web-shared` (Shared TypeScript/Svelte Source)

- **Source-only package:** Shared TypeScript helpers and small Svelte presentation
  primitives that are safe for both `nook-web-app` and `nook-web-extension`.
- **No ownership of domain policy:** Shared TS/Svelte code may coordinate UI,
  browser-page scanning, message DTOs, or wrapper helpers around WASM exports,
  but it must not own vault format logic, crypto, validation, password
  generation, or secret search. Those remain in `nook-core` and are exposed
  through `nook-wasm`.
- **No generated artifacts:** Generated WASM bindings continue to live under
  `nook-web/nook-web-app/src/lib/nook-wasm`; extension builds may import them
  explicitly from the sealed Docker image.

### E. `nook-web/nook-web-extension` (The Browser Extension Layer)

- **Manifest V3 package:** Browser extension build output lives in `nook-app/nook-web/nook-web-extension/dist`; source lives under `nook-app/nook-web/nook-web-extension/src`.
- **Separate product surface:** Popup UI, service worker, content scripts, and future autofill flows stay out of `nook-web` so extension-only browser privileges and page-injection code do not leak into the web app.
- **Task/Docker integration:** `task extension:build` builds the extension in Docker; `task extension:test:e2e` runs the extension Playwright smoke; the sealed `nook-web:local` image also builds `nook-app/nook-web-extension/dist` at image time. Use `task docker:extract:extension` to copy the built bundle to the host for manual browser loading.
- **Domain boundary:** The extension may consume WASM/domain APIs through explicit bridge modules when needed, but must not reimplement vault format logic, crypto, validation, password generation, or search filtering in TypeScript.

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
         → write encrypted_db / GitHub PUT
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
| Device identity (X25519 private)       | AES-256-GCM wrapped age secret + WebAuthn metadata             | IndexedDB `device_identity_wrapped`; legacy `device_identity_secret` exists only until one-time migration                                                                      |
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
- **IndexedDB `encrypted_db`:** UTF-8 YAML text (not hex).

---

## 5. Boundary Error Propagation Model

- All fallible WASM exports return `Result<T, wasm_bindgen::JsError>`.
- `NookError` maps to JS `Error` with message string.
- Svelte catches in `try/catch` on `VaultState` methods.

---

## 6. Testing Strategy

| Package     | Tests                                                                                                                                                                                                    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nook-core` / `nook-auth` | `task rust:coverage:check` — llvm-cov + nextest with **line coverage floor** (`nook-app/nook-core/coverage-floor.json`); fast path `task rust:test`                                                               |
| `nook-web/nook-web-app`  | Playwright e2e: `task web:test:e2e` (PR/main stub suite), `task web:test:e2e:pr` (fast manual subset), `task web:test:e2e:sync-live` (nightly); see [workflows/ci-pipeline.md](workflows/ci-pipeline.md) |
| `nook-wasm` | Covered via `nook-core` + e2e; no separate domain tests required                                                                                                                                         |
| `nook-web/nook-web-extension` | `task extension:check` for type/build validation; `task extension:test:e2e` for the Chromium extension smoke loaded from the packaged `dist` bundle |

Domain logic changes **must** add or update Rust tests before merge. **Line coverage must stay at or above 90%** (`task rust:coverage:check`).

---

## 7. The Engineering Harness

All development tasks run containerized via `Taskfile`. The root `Taskfile.yml` is the repo entrypoint; app-specific commands live in `nook-app/Taskfile.yml` and are included into the root command surface. Cross-package app/CI tasks stay under `nook-app/.task/`, Docker orchestration lives in `nook-app/docker/Taskfile.yml`, and web-family commands are owned by `nook-app/nook-web/Taskfile.yml` with local includes under `nook-app/nook-web/.task/`. The workspace **source is copied into the nook-web image** at build time (`nook-app/nook-web/nook-web-app/Dockerfile`) — there is **no runtime bind mount** on the common path, so the image is self-contained and reproducible. The explicit local-iteration exceptions are `task web:dev` / `task web:dev:fast` (Vite hot-reload) and `task wasm:build:fast` (mounted no-opt WASM regeneration).

### Two image tiers

- **Toolchain base** (`ghcr.io/<owner>/<repo>/toolchain`): `nook-base` (Rust/bun/task/mold/wasm-pack/llvm-cov on Debian trixie) + chef-cooked deps + crates.io registry + warm `target/` + bun deps + Playwright chromium. Pushed to GHCR as the shared cache (`:<git-commit>`/`:buildcache`, always **linux/amd64**). Rarely changes.
- **nook-web image** (`nook-web:local`): `FROM toolchain`, `COPY` the workspace source, layer in the generated wasm pkg, build the production `dist`. Rebuilt per commit; the source layer is small on top of the cached base. This is what `task` runs. Source is `COPY`'d as late as possible (after the wasm-pkg copy) so a source edit never invalidates the cached layers above it.

`task setup` always (re)builds the **nook-web** image (source may have changed); buildx reuses the toolchain base + GHCR `:buildcache`, so only the source + dist layers rebuild (seconds).

### Build export: docker driver + containerd image store

The nook-web image is large (~9 GB — it bakes the warm `target/` so runtime `task` never recompiles). Exporting that on every build is the dominant warm-build cost **if** it is re-materialized wholesale. We avoid that by building with the **`docker` driver** builder (BuildKit embedded in the daemon) on top of the **containerd image store**: the build result is written **directly into the image store**, so a warm rebuild only writes the small changed source/dist layers — the unchanged multi-GB deps/target layers are already there. A source-only change goes from a ~60 s full re-export down to **sub-second** export.

- **Builder selection:** `task setup` passes `--builder $(docker context show)`. buildx auto-creates a docker-driver builder named after the active context, so this resolves to `desktop-linux` on Docker Desktop and `default` on plain Linux/CI. **Never** point this at a `docker-container` builder (e.g. what `docker/setup-buildx-action` creates) — that driver forces a full-image re-export every build. Override with `BUILDX_BUILDER` if needed.
- **CI parity:** `.github/actions/nook-docker-setup` enables the containerd image store on the runner (`daemon.json` `features.containerd-snapshotter=true`, then restart + assert) and does **not** use `setup-buildx-action`. Recent `ubuntu-latest` (Docker 29+) enables it by default; we set it explicitly so the fast path survives runner-image drift.
- **Registry push is unaffected:** publishing the toolchain base to GHCR (`type=registry` / `type=cacheonly`) works from the docker driver; GHCR accepts the OCI manifests the containerd store produces.

**Shared cache is pull-always, push-main-only.** `cache-from` (the GHCR `:buildcache` layers plus the current commit tag when present) is wired for **every** build — local dev included — so a fresh checkout with a cold Docker cache pulls CI's warm dep/target layers instead of a catastrophic cold recompile. `cache-to` (publish) is gated on `TOOLCHAIN_PUSH`, which only **main** CI sets (`docker:push` -> `toolchain-push`, verified `:<git-commit>` image + `:buildcache`). PR CI and local dev never push (so no auth/`403`); an unauthenticated local pull that misses simply falls back to a cold build. No global mutable state blocks a local build — the registry is cache, not a dependency.

Docker bake orchestration is app-owned: `nook-app/Taskfile.yml` passes `nook-app/docker-bake.hcl` plus package-local bake files under `nook-app/**/docker-bake.hcl` to `docker buildx bake`, while the root `Taskfile.yml` includes those app commands for repo-root usage. The Taskfile passes bake files as absolute paths, grants buildx read access to the repo root, and sets every target context to the repo root so local and self-hosted runner buildx versions resolve paths the same way. The Docker build context remains the repository root, so the sealed app image can copy root workflow files (`Taskfile.yml`, `.task/agentic-ai.yml`, docs, and CI helper scripts) as well as `nook-app`.

### Docker cache model (no named volumes)

GitHub Actions **does not persist Docker named volumes** between jobs or workflow runs. Nook therefore **must not** rely on named volumes for `target/` or `node_modules` caching across runs.

| What                    | How it is cached                                                                                                                                                                                                                                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Toolchain base image    | `cache-from` pulled by **every** build (local + CI). **Main** publishes the verified `:<git-commit>` image + cache (`ci:main:publish` -> `toolchain-push`). PR CI and local dev never publish.                                                                            |
| Rust crate dependencies | **cargo-chef** (`cook --all-targets` + `cook --clippy --all-targets`) + clippy/test warm-up during the toolchain build. The chef planner copies only `Cargo.toml`/`Cargo.lock` plus dummy crate roots, so ordinary Rust source edits do not invalidate the dependency recipe.                                                               |
| `nook-app/target/`      | Lives at the **default in-tree path** `/meta-secret/nook/nook-app/target` (= Rust workspace root). Baked warm into the toolchain base; the nook-web image COPYs source over the same workdir and reuses it (no dep recompile). No bind mount means nothing shadows it — so **no `CARGO_TARGET_DIR` override, no `/opt` gymnastics, no single-container hack**. |
| `nook-app/nook-web/nook-web-app/node_modules` | Installed in the `web-deps` bake target (parallel branch, own `cache-to` like `builder-deps`). BuildKit cache mount at `/opt/nook/bun-install-cache` during `bun install`. `web:dev` (mounted) runs `bun install` in its command.                                                                                                         |
| Web wasm pkg            | Generated by `wasm-pack` in the wasm builder into `nook-app/nook-web/nook-web-app/src/lib/nook-wasm`; the nook-web image COPYs it from `builder-wasm` (gitignored/dockerignored, so it is not part of the source COPY).                                                                                                                                         |
| Web dist                | Built at **nook-web image build time** (`bun run build`, `VITE_BASE` arg) so it is present in every container: the Cloudflare preview deploy (in-container) and the GitHub Pages upload (extracted via `task docker:extract:dist`) both read it.                                                                                          |
| Playwright Chromium     | Pre-installed in `nook-base` (baked once; reruns only when base/Playwright version changes).                                                                                                                                                                                                                                              |
| CI Docker builds        | **`task ci:pr`** (PR verify, in-container Cloudflare deploy, GitHub `github-pages` deployment status for the PR head SHA) / **`task ci:main:publish`** (main — `toolchain-push` after green verify, then `docker:extract:dist` for Pages).                                                                                               |

Regenerate chef inputs after dependency changes: commit **`nook-app/Cargo.lock`** when dependencies change; `recipe.json` is produced during `docker build`.

### Sealed-image consequences

- **Write-type tasks emit diffs, not host writes.** `task format` / `task rust:coverage:update` mutate the in-container source and print a `git diff` (the nook-web image seeds a throwaway git repo). Apply on the host with `task format | git apply`.
- **`dist` hand-off.** Cloudflare (PR) deploys from inside the container, then PR CI records the Cloudflare URL as a successful GitHub `github-pages` deployment for ruleset enforcement. GitHub Pages (main) extracts `dist` to the runner with `task docker:extract:dist` before `upload-pages-artifact`.

### Build & verify

- **Native linking:** `nook-app/.cargo/config.toml` uses **mold** for `x86_64-unknown-linux-gnu` only (installed in the toolchain image); wasm32 targets keep the default linker.
- **Wasm:** generated by `wasm-pack build nook-wasm` from the `nook-app` workspace root in the `builder-wasm` stage into `nook-app/nook-web/src/lib/nook-wasm` (COPY'd into the nook-web image; mounted local-iteration paths `task web:dev`, `task web:dev:fast`, and `task wasm:build:fast` regenerate it when sources change). `WASM_BUILD_MODE=dev` is the default and skips `wasm-opt`; CI passes `WASM_BUILD_MODE=prod` explicitly for optimized artifacts. Chef-cached `nook-app/target/` at the default in-tree path.
- **Verify:** `task check` (fmt, clippy, `task rust:coverage:check`, svelte-check, eslint, vitest, vite build) using the default dev/no-opt WASM mode unless `WASM_BUILD_MODE=prod` is set.
