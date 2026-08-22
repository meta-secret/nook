# Package Responsibilities & Layers

## Overview

This document details the responsibilities, module structures, and interface boundaries of every package in the Nook workspace.

For the high-level architecture overview and dependency DAG, see [ARCHITECTURE.md](../ARCHITECTURE.md).

---

## 1. Rust Platform Crates

### Shared Leaf: `nook-app-common`

- **Cross-cutting primitives:** Owns dependency-light facilities needed by sibling portable crates without depending on their auth, event, or vault domains.
- **Localization source of truth:** Owns locale catalogs, translation behavior, and the single generated Rust translation-key registry. `nook-auth2` and `nook-core` consume it; `nook-core` may re-export the API for compatibility.
- **Strict scope:** Authentication policy stays in `nook-auth2`, vault semantics stay in `nook-core`, and browser behavior stays in `nook-wasm` or the web packages.

### Authenticator Domain: `nook-authenticator-domain`

- **Portable closed values:** Owns passkey-protection values, TOTP metadata, and backup-code update policy shared across authentication, vault, and extension boundaries.
- **Dependency-light boundary:** Has no dependency on another Nook crate.
- **Strict scope:** Browser ceremonies, persistence, extension lifecycle, and presentation remain in consumers and adapters.

### Identity and Authorization: `nook-auth2`

- **Identity and app-key foundations:** `IdentityId`, identity control records, app keys (`AppKey` / `AppId`), passkey bindings, and identity-owned per-vault DEK envelopes belong here. Legacy `DeviceIdentity` / `device_id` names are migration aliases only.
- **App-key protection:** Passkey PRF validation plus HKDF/AES-GCM wrapping for an installation-specific private app key. Browser/WebAuthn ceremonies stay outside this crate. Target model is a fresh random local app key; deterministic passkey-derived keys remain a compatibility boundary.
- **Authorization envelopes:** Current vault `auth:` rows remain the legacy wire boundary. Target ownership moves DEK envelopes onto the identity control log. Vault creation requires an identity with at least one key and a generated DEK.
- **Quorum recovery:** Fixed-policy SLIP-0039 recovery roots, protected per-device shares, and recovery-envelope helpers for `secrets_key` and `members_key` live here. Recovery exchange state stays out of sync providers.
- **Key material and row types:** Portable newtypes for vault key material, auth/member ids, age-armored ciphertext, signing public keys, and the opaque `StoredSecretRecord` row shape shared by user secrets and auth metadata.
- **No provider I/O:** No GitHub, Drive, iCloud, IndexedDB, OAuth, PAT, browser APIs, or sync reconciliation. Provider credentials authorize replica access only; they are not identity-membership or vault-unlock credentials.
- **Portability:** Compiles on native and `wasm32-unknown-unknown` so browser, extension, CLI, server, mobile, HSM, YubiKey, and future quorum-recovery adapters share identical key-access semantics.

### Replication Mechanics: `nook-replication`

- **Causal index:** Generic parent relationships, heads, ancestry, concurrency, pending-parent handling, deterministic topological ordering, quarantine indexing/exclusion, and set union.
- **Replica bookkeeping:** Provider-neutral immutable event bytes, per-provider outboxes, and missing-event repair planning.
- **No identity or vault policy:** No identity membership, vault operation, secret payload, actor authorization, key epoch, projection, provider credential, or session behavior. It supplies mechanics independently to identity-control and vault-event-log callers.
- **No provider I/O:** No GitHub, Drive, iCloud, IndexedDB, OAuth, browser API, or network transport. Hosts load and persist raw bytes.
- **Portability:** Compiles on native and `wasm32-unknown-unknown` without dependencies on `nook-core`, `nook-wasm`, or `nook-web`.

### Signed Vault History: `nook-event-log`

- **Canonical envelope:** Content-addressed event ids, canonical JSON body encoding, Ed25519 signatures, schema validation, and stable YAML storage bytes.
- **Vault operations:** Encrypted secret mutations, membership events, password-envelope changes, epoch checkpoints, and opaque fingerprint metadata.
- **Authorization graph:** Vault actor authorization layered over `nook-replication` generic causal index, including pending and quarantined events.
- **Projection:** Deterministic encrypted vault projection, replacement and security conflicts, key-epoch metadata, and replay-invariance checks.
- **Event-store orchestration:** Typed append, union, store classification, and compatibility between opaque replica bytes and validated vault events.
- **No plaintext or provider I/O:** No plaintext secret models, key encryption, GitHub, Drive, iCloud, IndexedDB, OAuth, browser APIs, or network transport.
- **Portability:** Depends only on `nook-auth2` wire/key-access types and `nook-replication` mechanics. Has no dependency on `nook-core`, `nook-wasm`, or `nook-web`.

### Extension Companion Domain: `nook-companion-core`

- **Portable extension policy:** Owns authentication workflow, pairing records and migrations, host classification, and form-field classification.
- **Shared domain inputs:** Depends on `nook-authenticator-domain` and `nook-event-log` without importing browser APIs.
- **Strict scope:** Chrome lifecycle, DOM observation, WASM adaptation, and presentation stay outside this crate.

### Application Domain Core: `nook-core`

- **`src/auth/`:** Compatibility re-exports for `nook-auth2` plus the core-only adapter that replays vault event operations into auth metadata state.
- **`src/crypto/`:** Vault encryption and key-epoch re-encryption. Canonical event signing lives in `nook-event-log`.
- **`src/secrets/`:** Secret payload types/views, mnemonic helpers, password generation, and plaintext session mutation helpers.
- **`src/sync/`:** Storage-provider validation/configuration, credential sealing, provider snapshot migration, vault reconciliation, and portable sync workflow states.
- **`src/vault/`:** In-memory database, vault formats, import/connect, event-session application services, session-cache workflows, typed access states, and portable idle/sync runtime policy. Signed history delegates to `nook-event-log`.
- **Application services:**
  - `vault_connect`: provider-agnostic connect decisions.
  - `vault_session` / `vault_session_cache`: unlock and session hydration.
  - `auth/enrollment`: identity enrollment.
  - `nook-event-log::builder` / `vault_event_session`: mutation and event orchestration.
  - `vault_sync_session` / `vault_sync_store`: sync reconciliation.
- **Host boundary:** `LocalEventStore` and `MemoryVaultStore` are portable in-memory service inputs. Browser event storage, projection cache, clocks, secure randomness ceremonies, and provider transports remain adapters in `nook-wasm`.
- **Root exports:** `nook-core` keeps established `nook_core::...` type and function paths available and re-exports the event-log domain alongside core-owned application services.

---

## 2. WebAssembly Bridge Layer

These crates and their generated consumer bindings are routed through
`internal_api_expert`. No separate WASM or bridge expert exists.

### Companion Bridge: `nook-companion-wasm`

- **Size-sensitive bridge:** Exposes `nook-companion-core` policy to extension contexts through `wasm-bindgen`.
- **Generated binding boundary:** Generated TypeScript and WASM artifacts live under `nook-web-shared/src/extension/nook-companion-wasm`.
- **No duplicated policy:** Authentication, pairing, host, and form-field rules remain in `nook-companion-core`.

### Bridge: `nook-wasm`

- **`NookVaultManager`:** Manages WASM session state including typed `Database`, vault metadata, `secrets_key`, `members_key`, `VaultCrypto`, device identity, and GitHub SHA.
- **Storage I/O:** Manages IndexedDB (`rexie`) and GitHub REST API (`reqwest`) network and database calls.
- **Device protection:** Persists and migrates wrapped identities, builds WebAuthn PRF option payloads via `1Password/passkey-rs` `passkey-types`, and exposes typed setup/unlock values to the web layer.
- **Exported methods:** Exposes `connect`, `add_secret`, `approve_join_request`, `enroll_and_connect`, and search query APIs.
- **No domain logic in WASM:** Validation, crypto, format conversions, and session decisions delegate directly to `nook-core`.
- **Runtime wrappers:** Runtime policy, secret forms, diagnostics, Sentinel session state, sync conflicts, and recovery issues are core-owned values exposed through typed wrappers.

---

## 3. Web Presentation Packages

### `nook-vault-simple`

- **Simple Vault product boundary:** Provides fixed Simple capability, Simple-only local registry, create/import/open/manage flows, and the extension-consent pairing route.
- **Origin isolation:** Deploys to `simple.nokey.sh` with its own origin-scoped IndexedDB, WebAuthn RP ID, session state, security headers, and Cloudflare Pages project.

### `nook-vault-sentinel`

- **Sentinel Vault product boundary:** Provides fixed Sentinel capability, Sentinel-only local registry, genesis/quorum/import/open/manage flows, no extension route or protocol UI, and Rust-rejected extension approval.
- **Origin isolation:** Deploys to `sentinel.nokey.sh` with independent origin storage and security headers.

### `nook-web-app`

- **Public site and test harness:** Public `nokey.sh` landing page, marketing/docs routes, and unified local/e2e test harness. Production build contains no active vault entrypoint.

### `nook-web-shared`

- **Source-only shared package:** Provides TypeScript helpers and Svelte 5 presentation primitives shared by Simple, Sentinel, and the browser extension.
- **Module organization:** Browser-owned modules are grouped by capability (`app`, `auth`, `content`, `enrollment`, `extension`, `runtime`, `vault`). Presentation components live in feature-oriented subpackages.
- **Single generated WASM binding:** `nook-wasm` compiles once into `nook-web-shared/src/vault-app/lib/nook-wasm`. Applications configure distinct immutable Rust identities during initialization.

### `nook-web-extension`

- **Manifest V3 companion:** Browser extension source in `nook-app/nook-web/nook-web-extension/src` and build output in `dist/`.
- **Simple Vault pairing:** Pairs exclusively with `simple.nokey.sh` via the extension device-protection widget and consent route. Excludes both vault origins from content script injection.
- **Domain delegation:** TypeScript coordinates Chrome APIs, DOM inspection, WebAuthn ceremonies, and timers, while delegating portable policy, payload validation, and persistence decisions to Rust/WASM.

### `nook-web-research`

- **Disposable UI experiment catalog:** Svelte 5 + Vite catalog for isolated UI experiments under `src/experiments/`. Has no production coupling, WASM dependency, or build pipeline ties.
- **Expert-routing exclusion:** This package is non-production and receives no module expert.
