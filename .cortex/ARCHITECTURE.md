# Nook System Architecture Specification

This document provides a comprehensive guide to Nook's architecture, package boundaries, data flows, and development environments. It serves as the primary technical context map for both human developers and autonomous AI coding agents.

---

## 1. Monorepo Structure & Dependency flow

Nook is built as a modular monorepo using a strict, uni-directional dependency flow. This prevents architectural drift, guarantees separation of concerns, and isolates WebAssembly bindings from core domain code.

```
+-------------------------------------------------------------+
|                         nook-web                            |
|             (Vite + Svelte 5 + TypeScript UI)               |
+-------------------------------------------------------------+
|                    nook-web-extension                       |
|       (Manifest V3 extension UI, service worker, scripts)   |
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
|     (Pure Rust: crypto, formats, validation, passwords)       |
+-------------------------------------------------------------+
```

### Dependency Enforcements

1. **No Circular Dependencies:** `nook-core` must not depend on `nook-wasm` or `nook-web`. `nook-wasm` must not depend on `nook-web`.
2. **Platform Portability:** `nook-core` compiles on native and `wasm32-unknown-unknown`. No browser APIs in `nook-core`.

---

## 2. Package Responsibilities & Layers

### A. `nook-core` (The Domain Core)

- **`multi_device`:** `secrets_key` + `members_key`, device identity, join/approve/enroll; YAML `auth:` / `joins:` / `members:` sections.
- **`device_key_protection`:** WebAuthn-PRF input/output validation, HKDF-SHA256 key derivation, and AES-256-GCM wrapping of the X25519 device identity.
- **`Database`:** In-memory JSONL session (sorted KV records); user secrets only at rest in session.
- **`vault_format`:** On-disk YAML (default) and JSONL serialization; auto-detect on load; `vault_version` monotonic counter.
- **`vault_sync`:** Version-based local/remote reconciliation (`compare_vault_sync`).
- **`vault_crypto`:** Session-scoped age encrypt/decrypt with cached scrypt identity/recipient.
- **`secret_types` / `secret_view`:** Typed secret payloads, YAML parse/serialize, display/search helpers shared across hosts.
- **`validation`:** Storage mode, PAT, secret field validation; label search filter.
- **`password`:** CSPRNG password generation via `getrandom`.
- **Tests:** Unit tests in each module + `tests/vault_workflow.rs` + `tests/multi_device_workflow.rs`.

### B. `nook-wasm` (The Bridge Layer)

- **`NookVaultManager`:** Session state — `decrypted_jsonl`, `stored_armored` cache, `secrets_key`, `members_key`, `VaultCrypto`, device identity, GitHub SHA.
- **Storage I/O:** IndexedDB (`rexie`), GitHub REST API (`reqwest`).
- **Device protection:** Persist/migrate the wrapped identity and expose typed setup/unlock values to the web layer.
- **Exported methods:** `connect`, `add_secret`, `approve_join_request`, `enroll_and_connect(secrets_key, members_key)`, etc.
- **No domain logic** that belongs in `nook-core` — validate/delegate/serialize via core.

### C. `nook-web` (The Web Presentation Layer)

- **Svelte 5 components:** Layout, forms, vault list UI.
- **`VaultState` (`vault.svelte.ts`):** Reactive shell — calls WASM, holds `secrets` for reactivity, auth provider state.
- **`auth-providers.ts`:** IndexedDB persistence for storage/sync providers — see [auth-providers.md](design-docs/auth-providers.md) (migrating to [unified-vault.md](design-docs/unified-vault.md)).
- **`passkey-device-protection.ts`:** Thin browser-only WebAuthn create/get adapter. It passes PRF output to WASM and performs no encryption.
- **`DeviceProtectionGate`:** Mandatory passkey setup/unlock before provider credentials or device keys are loaded.
- **`LoginGate`:** Login when vault is locked — create local vault, connect sync provider, or unlock existing cache; see [vault-session-and-lock.md](design-docs/vault-session-and-lock.md).
- **`VaultState.lockVault()`:** Clears WASM session + Svelte secrets; header **Lock vault** button.
- **`nook.ts`:** WASM loader + sync result mapping; vault secrets are `NookSecretRecord` wasm objects (no TS schema mirror).
- **No** vault format logic, crypto, validation, password generation, or search filtering in TS/Svelte.

### D. `nook-web-extension` (The Browser Extension Layer)

- **Manifest V3 package:** Browser extension build output lives in `nook-web-extension/dist`; source lives under `nook-web-extension/src`.
- **Separate product surface:** Popup UI, service worker, content scripts, and future autofill flows stay out of `nook-web` so extension-only browser privileges and page-injection code do not leak into the web app.
- **Task/Docker integration:** `task extension:build` builds the extension in Docker; the sealed `nook-web:local` image also builds `nook-web-extension/dist` at image time. Use `task docker:extract:extension` to copy the built bundle to the host for manual browser loading.
- **Domain boundary:** The extension may consume WASM/domain APIs through explicit bridge modules when needed, but must not reimplement vault format logic, crypto, validation, password generation, or search filtering in TypeScript.

---

## 3. Detailed Data Flow & Execution Model

### Connect (multi-device)

```
[Svelte] → navigator.credentials.get({ extensions: { prf: … } })
         → NookVaultManager.unlockDeviceIdentity(prf_output)
              → HKDF-SHA256 → AES-256-GCM unwrap of device identity
         → VaultState.loadDb()
         → NookVaultManager.connect(mode, pat)
              → use authorized device identity (memory)
              → load nook-vault.yaml (IDB or GitHub)
              → resolve_secrets_key() + resolve_members_key() from auth row
              → VaultCrypto::new(secrets_key)
              → decrypt user secret values → decrypted_jsonl session
```

### Add Secret (incremental save)

```
[Svelte] → add_secret(key, value)
         → validate_secret_label, validate_secret_value
         → update decrypted_jsonl (Database)
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
| Session (plaintext user secrets)       | JSONL lines                                                   | WASM `decrypted_jsonl` only                                                                                                                                                    |
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
- **Legacy JSONL vault files** load via `from_stored_auto`; new writes use YAML.
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
| `nook-core` | `task rust:coverage:check` — llvm-cov + nextest with **line coverage floor** (`nook-core/coverage-floor.json`); fast path `task rust:test`                                                               |
| `nook-web`  | Playwright e2e: `task web:test:e2e` (PR/main stub suite), `task web:test:e2e:pr` (fast manual subset), `task web:test:e2e:sync-live` (nightly); see [workflows/ci-pipeline.md](workflows/ci-pipeline.md) |
| `nook-wasm` | Covered via `nook-core` + e2e; no separate domain tests required                                                                                                                                         |

Domain logic changes **must** add or update Rust tests before merge. **Line coverage must stay at or above 90%** (`task rust:coverage:check`).

---

## 7. The Engineering Harness

All development tasks run containerized via `Taskfile`. The workspace **source is copied into the nook-web image** at build time (`nook-web/Dockerfile`) — there is **no runtime bind mount** on the common path, so the image is self-contained and reproducible. The one exception is `task web:dev`, which mounts the repo for Vite hot-reload.

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

### Docker cache model (no named volumes)

GitHub Actions **does not persist Docker named volumes** between jobs or workflow runs. Nook therefore **must not** rely on named volumes for `target/` or `node_modules` caching across runs.

| What                    | How it is cached                                                                                                                                                                                                                                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Toolchain base image    | `cache-from` pulled by **every** build (local + CI). **Main** publishes the verified `:<git-commit>` image + cache (`ci:main:publish` -> `toolchain-push`). PR CI and local dev never publish.                                                                            |
| Rust crate dependencies | **cargo-chef** (`cook --all-targets` + `cook --clippy --all-targets`) + clippy/test warm-up during the toolchain build.                                                                                                                                                                                                                   |
| `target/`               | Lives at the **default in-tree path** `/meta-secret/nook/target` (= WORKDIR). Baked warm into the toolchain base; the nook-web image COPYs source over the same workdir and reuses it (no dep recompile). No bind mount means nothing shadows it — so **no `CARGO_TARGET_DIR` override, no `/opt` gymnastics, no single-container hack**. |
| `nook-web/node_modules` | Installed in the `web-deps` bake target (parallel branch, own `cache-to` like `builder-deps`). BuildKit cache mount at `/opt/nook/bun-install-cache` during `bun install`. `web:dev` (mounted) runs `bun install` in its command.                                                                                                         |
| Web wasm pkg            | Generated by `wasm-pack` in the wasm builder into `nook-web/src/lib/nook-wasm`; the nook-web image COPYs it from `builder-wasm` (gitignored/dockerignored, so it is not part of the source COPY).                                                                                                                                         |
| Web dist                | Built at **nook-web image build time** (`bun run build`, `VITE_BASE` arg) so it is present in every container: the Cloudflare preview deploy (in-container) and the GitHub Pages upload (extracted via `task docker:extract:dist`) both read it.                                                                                          |
| Playwright Chromium     | Pre-installed in `nook-base` (baked once; reruns only when base/Playwright version changes).                                                                                                                                                                                                                                              |
| CI Docker builds        | **`task ci:pr`** (PR verify, in-container Cloudflare deploy, GitHub `github-pages` deployment status for the PR head SHA) / **`task ci:main:publish`** (main — `toolchain-push` after green verify, then `docker:extract:dist` for Pages).                                                                                               |

Regenerate chef inputs after dependency changes: commit **`Cargo.lock`** when dependencies change; `recipe.json` is produced during `docker build`.

### Sealed-image consequences

- **Write-type tasks emit diffs, not host writes.** `task format` / `task rust:coverage:update` mutate the in-container source and print a `git diff` (the nook-web image seeds a throwaway git repo). Apply on the host with `task format | git apply`.
- **`dist` hand-off.** Cloudflare (PR) deploys from inside the container, then PR CI records the Cloudflare URL as a successful GitHub `github-pages` deployment for ruleset enforcement. GitHub Pages (main) extracts `dist` to the runner with `task docker:extract:dist` before `upload-pages-artifact`.

### Build & verify

- **Native linking:** `.cargo/config.toml` uses **mold** for `x86_64-unknown-linux-gnu` only (installed in the toolchain image); wasm32 targets keep the default linker.
- **Wasm:** generated by `wasm-pack build nook-wasm` in the `builder-wasm` stage into `nook-web/src/lib/nook-wasm` (COPY'd into the nook-web image; `task wasm:build` only regenerates on the mounted `web:dev` path when sources change). Chef-cached `target/` at the default in-tree path.
- **Verify:** `task check` (fmt, clippy, `task rust:coverage:check`, svelte-check, eslint, vitest, vite build).
