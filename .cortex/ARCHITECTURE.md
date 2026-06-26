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
- **`Database`:** In-memory JSONL session (sorted KV records); user secrets only at rest in session.
- **`vault_format`:** On-disk YAML (default) and JSONL serialization; auto-detect on load.
- **`vault_crypto`:** Session-scoped age encrypt/decrypt with cached scrypt identity/recipient.
- **`validation`:** Storage mode, PAT, secret field validation; label search filter.
- **`password`:** CSPRNG password generation via `getrandom`.
- **Tests:** Unit tests in each module + `tests/vault_workflow.rs` + `tests/multi_device_workflow.rs`.

### B. `nook-wasm` (The Bridge Layer)
- **`NookVaultManager`:** Session state — `decrypted_jsonl`, `stored_armored` cache, `secrets_key`, `members_key`, `VaultCrypto`, device identity, GitHub SHA.
- **Storage I/O:** IndexedDB (`rexie`), GitHub REST API (`reqwest`).
- **Exported methods:** `connect`, `add_secret`, `approve_join_request`, `enroll_and_connect(secrets_key, members_key)`, etc.
- **No domain logic** that belongs in `nook-core` — validate/delegate/serialize via core.

### C. `nook-web` (The Presentation Layer)
- **Svelte 5 components:** Layout, forms, vault list UI.
- **`VaultState` (`vault.svelte.ts`):** Reactive shell — calls WASM, holds `secrets` for reactivity, auth provider state.
- **`auth-providers.ts`:** IndexedDB persistence for storage providers (GitHub PAT, local) — see [auth-providers.md](design-docs/auth-providers.md).
- **`LoginGate`:** Login-first UX when vault is locked; provider picker + one-time GitHub setup.
- **`nook.ts`:** WASM loader + thin record mapping.
- **No** vault format logic, crypto, validation, password generation, or search filtering in TS/Svelte.

---

## 3. Detailed Data Flow & Execution Model

### Connect (multi-device)
```
[Svelte] → VaultState.loadDb()
         → NookVaultManager.connect(mode, pat)
              → load/create device identity (IndexedDB)
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

| Layer | Format | Location |
|-------|--------|----------|
| Session (plaintext user secrets) | JSONL lines | WASM `decrypted_jsonl` only |
| On-disk user secrets | YAML `secrets:` list | Values encrypted with `secrets_key` |
| Active unlock mode | YAML `unlock:` tagged union | Either `{type: keys}` (per-device envelopes) or `{type: password, envelope: …}` (scrypt-wrapped vault keys). Mutually exclusive. See [password-envelope.md](product-specs/password-envelope.md). |
| On-disk key envelopes (keys mode only) | YAML `auth:` list | `pk_id` → age-armored `secrets_key` + `members_key` |
| Member catalog | YAML `members:` list | `pk_id` + `members_key`-encrypted `{pk_id, pk}` |
| Pending joins (keys mode only) | YAML `joins:` list | `device_id` → JSON (includes `public_key` while pending) |
| Device identity (X25519 private) | age secret string | IndexedDB `device_identity_secret` only |
| Auth providers (GitHub PAT, labels) | JSON snapshot | IndexedDB `nook_auth` → `providers` key |

See [decentralized-auth.md](product-specs/decentralized-auth.md) for join/approve flows.
See [auth-providers.md](design-docs/auth-providers.md) for login UX and multi-provider roadmap.

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

| Package | Tests |
|---------|-------|
| `nook-core` | `task rust:test` — unit + integration (`tests/vault_workflow.rs`) |
| `nook-web` | Playwright e2e via `task web:test:e2e:local` (no PAT) or `task web:test:e2e` (full suite); no vault domain unit tests in TS |
| `nook-wasm` | Covered via `nook-core` + e2e; no separate domain tests required |

Domain logic changes **must** add or update Rust tests before merge.

---

## 7. The Engineering Harness

All development tasks run containerized via `Taskfile` (`docker run` with the repo bind-mounted at `/workspace`).

### Docker cache model (no named volumes)

GitHub Actions **does not persist Docker named volumes** between jobs or workflow runs. Nook therefore **must not** rely on named volumes for `target/` or `node_modules` caching across runs.

| What | How it is cached |
|------|------------------|
| Toolchain image | Single **`ghcr.io/<owner>/<repo>/toolchain:latest`** image (always **linux/amd64**). `task setup` pulls it; `docker buildx bake` reuses registry layers and only rebuilds invalidated layers. **`toolchain:buildcache`** (BuildKit `mode=max`) stores intermediate layers such as `cargo chef cook` — the final image tag alone cannot restore those. CI pushes `:latest` after green verify; `:buildcache` updates on every registry build. |
| Rust crate dependencies | **cargo-chef** + clippy/test warm-up during image build. Baked artifacts live at `/opt/nook/target`. |
| `target/` at runtime | Bind-mounting the repo hides image layers under `/workspace/target`. The **entrypoint** copies `/opt/nook/target` into the workspace when `target/debug/deps` is empty (fresh CI checkout). Within one CI job, later `docker run` invocations reuse the same host `target/` via the bind mount. |
| `nook-web/node_modules` | Each `docker run` overlays an **anonymous volume** at `/workspace/nook-web/node_modules` so parallel containers install independently. `BUN_INSTALL_CACHE_DIR` is baked at `/opt/nook/bun-install-cache`; the entrypoint runs `bun install --frozen-lockfile` (fast link from cache; correct rolldown native bindings). |
| Playwright Chromium | `playwright install --with-deps chromium` during image build at `PLAYWRIGHT_BROWSERS_PATH=/opt/nook/ms-playwright`. |
| CI Docker builds | **One `task setup` per workflow run**. Pull `toolchain:latest`, build only changed layers, push after green verify. |

Regenerate chef inputs after dependency changes: `task docker:generate-recipe` (commit `recipe.json` and `Cargo.lock`).

### Build & verify

- **Wasm:** `task wasm:build` — `wasm-pack build nook-wasm` from the workspace root (prebuilt `wasm-pack` + `wasm-bindgen` in the image; chef-cached `target/` seeded by the entrypoint).
- **Verify:** `task check` (fmt, clippy, `cargo test -p nook-core`, svelte-check, eslint, vitest, vite build).
