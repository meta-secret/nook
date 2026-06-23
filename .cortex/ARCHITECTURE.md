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
| On-disk key envelopes | YAML `auth:` list | `pk_id` → age-armored `secrets_key` + `members_key` |
| On-disk password envelope (optional) | YAML `password_envelope:` record | scrypt-derived age envelope of `{secrets_key, members_key}`; alternate unwrap path for QR-based join (see [password-envelope.md](product-specs/password-envelope.md)) |
| Member catalog | YAML `members:` list | `pk_id` + `members_key`-encrypted `{pk_id, pk}` |
| Pending joins | YAML `joins:` list | `device_id` → JSON (includes `public_key` while pending) |
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
| `nook-core` | `cargo test -p nook-core` — unit + integration (`tests/vault_workflow.rs`) |
| `nook-web` | Playwright e2e (`npm run test:e2e`); no vault domain unit tests in TS |
| `nook-wasm` | Covered via `nook-core` + e2e; no separate domain tests required |

Domain logic changes **must** add or update Rust tests before merge.

---

## 7. The Engineering Harness

All development tasks should run containerized via `Taskfile`:

- **Build Target:** `wasm32-unknown-unknown` via `wasm-pack` → `nook-web/src/lib/nook-wasm/`
- **Optimization:** `wasm-opt` v122+ in production pipeline
- **Verify:** `task check` (fmt, clippy, `cargo test`, svelte-check, eslint, vitest, vite build)
