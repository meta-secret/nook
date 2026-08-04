# Nook System Architecture Specification

This document provides a comprehensive guide to Nook's architecture, package boundaries, data flows, and development environments. It serves as the primary technical context map for both human developers and autonomous AI coding agents.

---

## 1. Monorepo Structure & Dependency flow

Nook is built as a modular monorepo using a strict, uni-directional dependency flow. App code lives under the root `nook-app/` directory, which contains the Rust core, WASM bridge, web app, browser-extension package, and Docker build definitions for the split Rust/WASM and web images. This prevents architectural drift, guarantees separation of concerns, and isolates WebAssembly bindings from core domain code.

```
root/
├── Taskfile.yml          (repo entrypoint; includes app tasks + root tooling)
├── infra/
│   ├── Taskfile.yml      (composition root for the infrastructure command surface)
│   ├── tasks/            (flattened domain-owned SeaweedFS sccache, registry, k0s, Kata, Neo4j, and Hive operations)
│   ├── compose.yaml      (private persistent infrastructure services)
│   └── k0s/              (pinned single-node cluster and Hive manifests)
├── agentic-ai/
│   ├── ci-agent/         (PR delivery agent)
│   └── minds/
│       ├── lace/         (agent task graph)
│       └── hive/         (Kata-isolated embedded-Codex worker)
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
    ├── nook-app-common/     (shared leaf primitives and localization)
    ├── nook-auth2/
    ├── nook-replication/
    ├── nook-event-log/
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
nook-wasm                     browser I/O, session, wasm-bindgen
  └─> nook-core               secrets, sessions, sync policy, crypto
       ├─> nook-event-log     signed events, authorization, projection
       │    ├─> nook-auth2 ──> nook-app-common
       │    └─> nook-replication
       └─> nook-app-common    shared leaf primitives and localization
```

### Dependency Enforcements

1. **No Circular Dependencies:** `nook-core` must not depend on `nook-wasm` or `nook-web`. `nook-wasm` must not depend on `nook-web`.
2. **Platform Portability:** `nook-app-common`, `nook-auth2`, `nook-replication`, `nook-event-log`, and `nook-core` compile on native and `wasm32-unknown-unknown`. No browser APIs in these crates; simple domain DTOs/enums may carry `wasm-bindgen` annotations so web callers use the same typed core models.

### Security-domain model

Nook separates identity management from encrypted vault storage:

```text
person -> [virtual identity A | virtual identity B | ...]
passkey/local protector -> local device key -> identity public-key record
replication provider -> encrypted identity control log
identity -> encrypted DEK authorization grant -> vault
replication provider -> encrypted vault event log
```

An identity is a virtual account; one person may use multiple identities and
each identity may have zero or more keys. Physical devices are hardware
inventory, installations are local storage contexts, and installation-specific
device keys are cryptographic authority. Identity
records replicate public device keys and passkey credential records through
identity-specific provider mounts; private device keys remain local. A vault
owns its `store_id`, independent DEK, encrypted content, signed event log,
projection, and grant policy. Passwords are vault content. A provider is a
caller-supplied replication adapter, never an identity or unlock factor.
Provider credentials stay sealed to a local device key. The normative model,
passkey-locality rules, and migration boundary are in
[identity-vault-architecture.md](design-docs/identity-vault-architecture.md).

---

## 2. Package Responsibilities & Layers

### Shared leaf: `nook-app-common`

- **Cross-cutting application primitives:** Owns dependency-light facilities
  needed by sibling portable crates without depending on their auth, event, or
  vault domains.
- **Localization source of truth:** Owns locale catalogs, translation behavior,
  and the single generated Rust translation-key registry. `nook-auth2` and
  `nook-core` consume it; `nook-core` may compatibility-re-export the API.
- **Not a dumping ground:** Authentication policy stays in `nook-auth2`, vault
  semantics stay in `nook-core`, and browser/platform behavior stays in
  `nook-wasm` or the web packages.

### A. `nook-auth2` (Portable Identity and Vault Authorization)

- **Device and identity foundations:** Virtual identity ids, X25519 device-key
  generation, physical-device/key distinction, device fingerprints,
  identity/member relationships, auth ids, and age envelopes.
- **Device-key protection:** Passkey PRF result validation plus HKDF/AES-GCM
  wrapping for an installation-specific private device key. Browser/WebAuthn
  ceremonies stay outside this crate. The target model always generates a
  fresh random local device key; deterministic passkey-derived identities are
  an existing compatibility boundary, not the future physical-device model.
- **Authorization envelopes:** Current `auth:` rows, `password_entries`,
  enrollment payloads, member roster encryption, and key-resolution helpers
  implement the existing wire boundary. Their target meaning is an explicit
  identity-to-vault grant for the vault DEK/key hierarchy.
- **Quorum recovery:** Fixed-policy SLIP-0039 recovery roots, protected per-device shares, and recovery-envelope helpers for `secrets_key` and `members_key` live here; recovery request/response exchange state stays out of sync providers.
- **Key material and row types:** Portable newtypes for vault key material, auth/member ids, age-armored ciphertext, signing public keys, and the opaque `StoredSecretRecord` row shape shared by user secrets and auth metadata.
- **No provider I/O:** No GitHub, Drive, iCloud, IndexedDB, OAuth, PAT, browser
  APIs, or sync reconciliation. Provider credentials authorize replica access
  only; they are not identity-membership or vault-unlock credentials.
- **Portability:** Compiles on native and `wasm32-unknown-unknown` so browser, extension, CLI, server, mobile, HSM, YubiKey, and future quorum-recovery adapters can share the same key-access semantics.

### B. `nook-replication` (Portable Replication Mechanics)

- **Causal index:** Generic parent relationships, heads, ancestry,
  concurrency, pending-parent handling, deterministic topological ordering,
  quarantine indexing/exclusion, and set union.
- **Replica bookkeeping:** Provider-neutral immutable event bytes, per-provider
  outboxes, and missing-event repair planning.
- **No identity or vault policy:** No identity membership, vault operation,
  secret payload, actor authorization, key epoch, projection, provider
  credential, or session behavior. It supplies mechanics independently to
  identity-control and vault-event-log callers.
- **No provider I/O:** No GitHub, Drive, iCloud, IndexedDB, OAuth, browser API,
  or network transport. Hosts remain responsible for loading and persisting
  bytes.
- **Portability:** Compiles on native and `wasm32-unknown-unknown`; it has no
  dependency on `nook-core`, `nook-wasm`, or `nook-web`.

### C. `nook-event-log` (Portable Signed Vault History)

- **Canonical envelope:** Content-addressed event ids, canonical JSON body
  encoding, Ed25519 signatures, schema validation, and stable YAML storage
  bytes.
- **Vault operations:** Encrypted secret mutations, membership events,
  password-envelope changes, epoch checkpoints, and opaque fingerprint metadata.
- **Authorization graph:** Vault actor authorization layered over
  `nook-replication`'s generic causal index, including pending and quarantined
  events.
- **Projection:** Deterministic encrypted vault projection, replacement and
  security conflicts, key-epoch metadata, and replay-invariance checks.
- **Event-store orchestration:** Typed append, union, store classification, and
  compatibility between opaque replica bytes and validated vault events.
- **No plaintext or provider I/O:** No plaintext secret models, key encryption,
  GitHub, Drive, iCloud, IndexedDB, OAuth, browser APIs, or network transport.
- **Portability:** Depends only on `nook-auth2` wire/key-access types and
  `nook-replication` mechanics; it has no dependency on `nook-core`,
  `nook-wasm`, or `nook-web`.

The name is deliberate: Nook's source of truth is a multi-head causal event
DAG, so `commit-log` would incorrectly imply a linear history.
`event-sourcing` would imply command and application-service ownership beyond
this crate.

### D. `nook-core` (The Application Domain Core)

- **`src/auth/`:** Compatibility re-exports for `nook-auth2` plus the core-only adapter that replays vault event operations into auth metadata state.
- **`src/crypto/`:** Vault encryption and key-epoch re-encryption. Canonical
  event signing lives in `nook-event-log`.
- **`src/secrets/`:** Secret payload types/views, mnemonic helpers, password generation, and plaintext session mutation helpers.
- **`src/sync/`:** Storage-provider validation/configuration, credential sealing,
  provider snapshot migration, vault reconciliation, and portable sync workflow
  states (last-success observation, manual provider operation, conflict review,
  and local-folder health).
- **`src/vault/`:** In-memory database, vault formats, import/connect,
  event-session application services, session-cache workflows, typed access
  states, and portable idle/sync runtime policy. Signed history delegates to
  `nook-event-log`.
- **Application services:** Provider-agnostic connect decisions live in
  `vault_connect`; unlock/session hydration in `vault_session` and
  `vault_session_cache`; enrollment in `auth/enrollment`; mutation/event
  orchestration in `nook-event-log::builder` and `vault_event_session`; and sync
  reconciliation in `vault_sync_session` and `vault_sync_store`. Hosts load or
  persist bytes, tokens, revisions, and timestamps, then call these services;
  they do not repeat their decisions.
- **Host boundary:** `LocalEventStore` and `MemoryVaultStore` are portable
  in-memory service inputs. Browser event storage, projection cache, clocks,
  secure randomness ceremonies, and provider transports remain adapters in
  `nook-wasm`; portable functions receive their resulting typed data explicitly.
- **Root exports:** `nook-app/nook-core/src/lib.rs` keeps the established
  `nook_core::...` type and function paths available by re-exporting the
  event-log domain alongside core-owned application services. Fallible
  event-log APIs return `EventResult` / `EventError` at both crate roots;
  core-owned application services convert those errors into
  `VaultResult` / `VaultError`.
- **Tests:** Unit tests in each module + `tests/vault_workflow.rs` + `tests/multi_device_workflow.rs`.

### E. `nook-wasm` (The Bridge Layer)

- **`NookVaultManager`:** Session state — typed `Database`, vault metadata, `secrets_key`, `members_key`, `VaultCrypto`, device identity, GitHub SHA.
- **Storage I/O:** IndexedDB (`rexie`), GitHub REST API (`reqwest`).
- **Device protection:** Persist/migrate the wrapped identity, build WebAuthn PRF option payloads with `1Password/passkey-rs` `passkey-types`, and expose typed setup/unlock values to the web layer. Delegates portable key wrapping and auth metadata behavior to `nook-auth2` through `nook-core`.
- **Exported methods:** `connect`, `add_secret`, `approve_join_request`, `enroll_and_connect(secrets_key, members_key)`, etc.
- **No domain logic** that belongs in `nook-core` — validate/delegate/serialize via core.
- **Runtime wrappers:** Runtime policy, architecture, secret forms, diagnostics,
  Sentinel session/finalization state, sync conflicts, and recovery issues are
  core-owned values exposed through typed wrappers. WASM does not own timeout
  rules, domain DTO mirrors, or string status taxonomies.

### F. Isolated vault applications (The Web Presentation Layer)

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
  `NookSecretRecord` only for reveal/secret-copy. Portable client transitions,
  provider scoping/staging/metadata rules, sync workflow variants,
  vault-architecture drafts, and page normalization are owned by `nook-core`
  and exposed through typed WASM APIs; the Svelte shell stores those generated
  values reactively and applies their outcomes to browser/UI state. Cohesive browser
  workflows live in focused `lib/vault/*` action modules; `vault.svelte.ts`
  remains the reactive facade and must not grow duplicate implementations.
- **`auth/providers.ts` (shared):** Thin TS adapters + i18n over WASM `NookVaultManager` load/save APIs. IndexedDB `nook_auth` persistence and credential sealing live in `nook-wasm` / `nook-core` — see [auth-providers.md](design-docs/auth-providers.md).
- **`auth/passkey-device-protection.ts`:** Thin browser-only WebAuthn create/get adapter. Rust/WASM builds the PRF option payloads; TypeScript invokes `navigator.credentials`, extracts the returned PRF output, and performs no encryption. `nook-wasm/src/passkey_browser.rs` classifies WebAuthn `NotAllowedError` as the stable `PASSKEY_CEREMONY_NOT_ALLOWED` result because the browser intentionally uses it for cancellation, timeout, policy refusal, and unavailable credentials. UI callers localize that ambiguity for create, recovery, and unlock flows; they must not infer PRF absence or offer the PIN fallback unless the browser returns the distinct PRF-unavailable result.
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
- **Canonical source:** `nook-web-shared/src/vault-app` is imported directly by
  the Unified, Simple, and Sentinel projects. Do not recreate an app-local
  `src/lib` symlink or copy shared entrypoints/components into those projects.
- **Package-oriented modules:** `vault-app/lib` keeps only the `nook.ts`,
  `utils.ts`, and `vault.svelte.ts` facades at its root. Browser-owned modules
  are grouped by capability under `app`, `auth`, `content`, `enrollment`,
  `extension`, `runtime`, and `vault`; provider-specific authentication adapters
  live under `auth/google` and `auth/icloud`. Presentation remains under
  `components`, with its own feature-oriented subpackages, rather than being
  mixed into browser adapters.
- **No ownership of domain policy:** Shared TS/Svelte code may coordinate UI,
  browser-page scanning, message DTOs, or adapters around WASM exports, but it
  must not own vault format logic, crypto, validation, password generation, or
  secret search. Generated WASM types/functions are imported or re-exported
  directly; a TypeScript wrapper must perform an actual lifecycle, reactive
  proxy, UI-default, or browser-state translation. Those domain behaviors and
  types remain in `nook-core` and are exposed through `nook-wasm`.
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
- **Two user-facing responsibilities:** The extension acts for a selected
  virtual identity through its installation-specific device key and manages
  that identity's authorized relationship with a website/origin. It then
  integrates vault-owned passwords and website passkeys after an applicable
  vault grant is active. The first is identity management; the second is
  vault-content integration. Neither turns the extension into a third vault
  application.
- **Task/Docker integration:** `task extension:build` builds the extension in Docker; `task extension:test:e2e` runs the extension Playwright smoke; the sealed `nook-web:local` image also builds `nook-app/nook-web/nook-web-extension/dist` at image time. Use `task docker:extract:extension` to copy the built bundle to the host for manual browser loading. `task extension:install:hosted` and the hosted `extension:run:*` variants verify deployment metadata and SHA-256, activate an immutable release atomically, and launch it only in a channel-specific isolated browser profile. `task extension:smoke:hosted CHANNEL=dev` or `PR=<number>` uses the verified hosted bundle and matching Simple Vault deployment for the full pairing, vault, login-fill, lock, and restart flow, then removes its temporary browser and vault state; production is intentionally rejected because the smoke creates vault data.
- **Domain boundary:** The extension may consume WASM/domain APIs through explicit bridge modules when needed, but must not reimplement vault format logic, crypto, validation, password generation, or search filtering in TypeScript.
- **Local projection bridge:** Simple Vault publishes its canonical encrypted,
  signed event log after local mutations and provider pulls. A content script
  restricted to the configured Simple origin transports that snapshot to the
  service worker; Rust/WASM validates canonical ids/signatures, store identity,
  the extension's protected device id, current approval, and revocation before
  persisting an extension-origin IndexedDB projection. Non-secret connection
  metadata also remains in WASM-managed extension-origin Rexie/IndexedDB. Sync providers complement this bridge for
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

```text
[Svelte] → prepareSecretSearch() on the first non-empty query
         → load + decrypt IndexedDB secret_search_v2:{store_id}:{bucket}
         → verify authenticated buckets and reconcile by ciphertext digest
           (decrypt new, changed, or invalid rows only)
         → encrypt only changed ID-derived buckets; vault open already deleted the legacy plaintext key
         → nook-core::SecretSearchCatalog::query over normalized in-memory text
         → return the requested metadata page without record decryption
```

---

## 4. Storage & Cryptographic Specs

| Layer                                  | Format                                                        | Location                                                                                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Session (plaintext user secrets)       | Typed `Database` records                                      | WASM memory only                                                                                                                                                               |
| On-disk user secrets                   | YAML `secrets:` list                                          | Values encrypted with `secrets_key`                                                                                                                                            |
| Local search catalog                   | Age-encrypted, authenticated `SecretListItem` buckets         | IndexedDB `secret_search_v2:{store_id}:{bucket}`; decrypted into WASM memory only while unlocked, with bucket assignment derived from opaque secret ids                         |
| Logical secret store                   | YAML `store_id`                                               | `store_{token}` — same across provider replicas ([secret-store-identity.md](design-docs/secret-store-identity.md))                                                             |
| Vault revision                         | Event-log causal heads (+ legacy YAML `vault_version`)        | Live sync is the event log ([vault-event-log.md](design-docs/vault-event-log.md)); scalar `vault_version` is historical/local projection context ([unified-vault.md](design-docs/unified-vault.md)) |
| Active unlock mode                     | YAML `unlock:` tagged union (omitted when keys — the default) | `{type: password, …}` for password-only vaults; device-key vaults use `auth:` (+ optional `password_entries`). See [password-envelope.md](product-specs/password-envelope.md). |
| Current vault authorization envelopes  | YAML `auth:` list                                             | Existing per-device wire encoding of encrypted `secrets_key` + `members_key`; target ownership is an identity-to-vault DEK grant                                               |
| Current vault member catalog           | YAML `members:` list                                          | Existing `pk_id` + `members_key`-encrypted relationship data; identity membership is moving to the independent identity domain                                                 |
| Current vault-coupled joins            | YAML `joins:` list                                            | Existing transient device join wire; target onboarding belongs to identity management before a separate vault grant                                                           |
| Current device identity (X25519 private) | AES-256-GCM wrapped or passkey-derived age secret + WebAuthn PRF/PIN metadata | IndexedDB `device_identity_wrapped`; deterministic standard mode is compatibility state. Target: fresh random installation-specific device key wrapped locally; identity records sync only its public key. |
| Replication-provider connections       | JSON snapshot                                                 | IndexedDB `nook_auth` → `providers` key; credentials are sealed to the local device and targets may be mounted independently by identity and vault logs                         |

See [vault-session-and-lock.md](design-docs/vault-session-and-lock.md) for Lock vs persisted data.
See [decentralized-auth.md](product-specs/decentralized-auth.md) for join/approve flows.
See [auth-providers.md](design-docs/auth-providers.md) for login UX and sync-provider credential persistence.
See [vault-event-log.md](design-docs/vault-event-log.md) for provider event-log sync.
See [unified-vault.md](design-docs/unified-vault.md) for local-first vault architecture (scalar sync historical).
See [identity-vault-architecture.md](design-docs/identity-vault-architecture.md) for identity, onboarding, grant, and provider ownership.

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
| `preflight` | `task preflight` — standalone Rust tests for whole-repository invariants, including Rust/WASM-to-TypeScript boundary mirrors, authored TypeScript/Svelte absence semantics, no-op forwarding wrappers, unchecked WASM type hints, and raw provider/auth `JsValue` DTO signatures; runs before app setup in PR/main CI                                                                        |
| `nook-core` / `nook-auth2` / `nook-replication` / `nook-event-log` | `task rust:coverage:check` — llvm-cov + nextest with **line coverage floor** (`nook-app/nook-core/coverage-floor.json`); fast path `task rust:test`                                                               |
| `nook-web/nook-web-app`  | Playwright e2e: `task web:test:e2e` (main stub gate and explicit PR validation), `task web:test:e2e:pr` (fast manual subset), `task web:test:e2e:sync-live` (manual real-provider validation); see [workflows/ci-pipeline.md](workflows/ci-pipeline.md) |
| `nook-wasm` | Covered via `nook-core` + e2e; no separate domain tests required                                                                                                                                         |
| `nook-web/nook-web-extension` | `task extension:check` for type/build validation; `task extension:test:e2e` for the Chromium extension smoke loaded from the packaged `dist` bundle |

Domain logic changes **must** add or update Rust tests before merge. **Line coverage must stay at or above 90%** (`task rust:coverage:check`).

---

## 7. The Engineering Harness

All development tasks run containerized via `Taskfile`. The root `Taskfile.yml` is the repo entrypoint; app-specific commands live in `nook-app/Taskfile.yml` and are included into the root command surface. Cross-package app/CI tasks stay under `nook-app/.task/`, Docker orchestration lives in `nook-app/docker/Taskfile.yml`, and web-family commands are owned by `nook-app/nook-web/Taskfile.yml` with local includes under `nook-app/nook-web/.task/`. `infra/Taskfile.yml` is the infrastructure composition root; it flattens domain-owned command modules under `infra/tasks/` into one public command surface. Every infrastructure Taskfile must be reachable from that root, and operation shell bodies stay inside their owning domain Taskfile. Orphan Taskfiles and standalone shell scripts under `infra/` are prohibited and rejected by preflight. The workspace **source is copied into the nook-web image** at build time (`nook-app/nook-web/nook-web-app/Dockerfile`) — there is **no runtime bind mount** on the common path, so the image is self-contained and reproducible. The explicit local-iteration exceptions are `task web:dev` / `task web:dev:fast` (Vite hot-reload over trusted `https://localhost:<port>` using ignored TLS material in `.nook/https/`) and `task wasm:build:fast` (mounted no-opt WASM regeneration). `task web:https:setup` builds and runs the pinned repository `mkcert` container; only the final CA trust operation runs on the host because the browser consumes the host trust store. Playwright and CI keep their isolated loopback-HTTP transport when real passkey/OAuth/provider ceremonies are not under test.

PR delivery helpers live in `agentic-ai/ci-agent` and are exposed as `task
pr:preflight`, `task pr:review`, and `task pr:ready`. The optional review command
posts an idempotent SHA-bound Codex request; the audit commands emit
machine-readable exact-head state without waiting for an external reviewer and
never merge a PR. Nook has no event-driven
PR auto-merger: workflows do not merge blindly from check events. Instead, the
task-owning agent runs the readiness audit and squash-merges immediately when it
passes. Local ci-agent Docker tags are worktree-scoped so another checkout cannot
replace the audit binary between build and readiness execution. Extension
iteration and all other heavy agent feedback run through the allowlisted
GitHub-hosted remote task catalog. Required product validation runs on GitHub
Actions only after the coherent pushed iteration is explicitly selected with a
validation label; agents do not run local `task check` / `task ci:pr` gates.
The frequent `rust:test`, `web:check`, `web:test`, and `extension:check`
dispatches use narrow source-sealed images: native tests branch directly from
the manifest-keyed Rust dependency image, while web checks consume only web
dependencies plus the generated WASM package. They do not join unrelated
coverage, WASM-test, browser, full verification, or production-build stages.
All branch code still executes on ephemeral GitHub-hosted runners; the
self-hosted `nook` pool remains maintenance-only.

### Split Rust/WASM and web images

- **Rust/WASM lineage**: `rust-base` + manifest-only chef cooking exposes a lightweight WASM dependency boundary, while native verification extends it with nextest/clippy/coverage profiles. Hosted PR CI runs native coverage independently and verifies WASM once on a dedicated producer; web verification and opt-in browser jobs download that producer's small run-stable artifact instead of rebuilding Rust/WASM. `Verify and preview` starts in parallel, prepares its runner, then polls only for the current producer attempt's clippy-clean WASM package while the producer finishes required Node tests. Rust coverage reporting is a separate native-dependent job that downloads the completed handoff directly, so preview never idles on native compilation. The overall gate still requires all jobs, producer failures are reported explicitly, and preview deployment remains blocked until the Node-test producer succeeds. Hosted CI persists the toolchain, stable native/WASM dependency boundaries, and separate source-sensitive native/WASM snapshots as private Zot BuildKit refs. Every PR job reads only Main's complete lineage and does not export branch-local caches; explicit Remote tasks may update only their deterministic branch refs with Main fallback. Trusted Main and Remote compiler vertices also reuse bucket-scoped SeaweedFS `sccache` objects through stable BuildKit secret mounts. Explicit `task rust:*` / `task wasm:*` commands load the source-sealed `nook-rust:local` image on demand; browser-only WASM tests and mounted Vite development use `nook-rust-browser:local`.
- **Web lineage**: `web-base` contains Bun, Node, and Task; `web-deps` adds `node_modules`. PR unit/preview builds use this browser-free lineage. The CI-only web target runs format/lint/check/tests as a sibling of the production web/extension build and joins both successful branches into the same sealed image, instead of serializing verification after the build. `web-e2e-base` adds Playwright Chromium only for main/manual e2e and uses a separate `:web-e2e-*` cache, so PR cache imports never pull the browser layer. Neither lineage contains Cargo or `target/`.
- **Common task image** (`nook-web:local`): starts from `web-base`, adds `node_modules`, the generated WASM package, coverage artifacts, workspace source, and built web/extension output. This is the slim image used by normal Task and CI runtime checks.

`task setup` has two solves. The first builds web dependencies alongside a Rust graph that fans out from cached dependencies into native verification and WASM, then exports the scratch `web-artifacts` join under `${TMPDIR}/nook-web-artifacts/<full-commit-sha>/<unique-invocation>/`. The commit namespace isolates different revisions, and the invocation namespace prevents concurrent builds of the same revision from racing. That directory contains only generated WASM and coverage files and is guarded at 256 MiB. The second solve supplies it as a named host context to `nook-web`; it never passes either multi-GB Rust branch as a Docker context or parent. Only this small final web solve is retried once after the known immediate BuildKit frontend/Dockerfile-load flake, so the expensive preparation graph is never repeated. The final Dockerfile also asserts that `/usr/local/cargo` and `nook-app/target` are absent.

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

The old combined `nook-web` filesystem was about 9 GB because it inherited warm Rust `target/`, the compiler, Cargo registry, web dependencies, and Playwright. The split keeps those caches in independent BuildKit lineages. Only the WASM package and coverage outputs cross from Rust to web through the commit-scoped, invocation-isolated host directory, and the common runtime image contains no Rust toolchain or `target/`. The normal **`docker` driver** builder writes the web result directly to the containerd image store, avoiding an extra archive/import cycle. Hosted delivery validation uses an ephemeral `docker-container` builder and restores the independent lineages from `registry.dev.nokey.sh`.

- **Builder selection:** normal local `task setup` and optional local `task ci:*` callers use the active Docker-context daemon builder (`desktop-linux` on Docker Desktop or `default` on plain Linux). They never share a `nook-pr` docker-container. GitHub Actions creates an ephemeral job-scoped `docker-container` builder with `docker/setup-buildx-action` and passes that unique name through the bounded health wrapper before repository preflight and app solve phases begin; warm layers come from authenticated registry cache refs, not from reusing one host BuildKit container across deployments.
- **CI parity:** `.github/actions/nook-docker-setup` raises Linux watcher limits, creates and exports the hosted `docker-container` Buildx builder for both wrapped and direct Task callers, logs into `registry.dev.nokey.sh`, and enables Bake registry cache refs. Trusted Main receives the SeaweedFS writer identity while explicit Remote compiler vertices receive a read-only identity through stable BuildKit secret IDs; PR, arbitrary-ref, dependency-update, and AI-authored jobs remain secret-free. Delivery does not depend on the daemon's default image store and never rewrites daemon configuration or restarts Docker.
- **BuildKit caching crosses hosted VMs through `registry.dev.nokey.sh`:** local commands keep using the selected builder's local content store with `GHA_CACHE_ENABLED` empty. Hosted CI first stabilizes the shared Rust toolchain parent in `nook-rust-base-v1`, then exports native and WASM dependency boundaries to `nook-rust-deps-v2` and the fingerprinted WASM deps ref with `mode=max`. Source-sensitive native coverage and WASM outputs use separate `nook-rust-native-source-v2` and `nook-rust-wasm-source-v2` refs, so a workflow-only or web-only push does not recompile unchanged Rust on a fresh hosted runner. Every PR job restores only Main's refs and disables export. Web dependencies, browser-free web, and e2e web also use distinct refs and `mode=max`. Cache export errors on web lineages are non-fatal because cache is an optimization. Zot is reached only through Traefik HTTPS at `registry.dev.nokey.sh` with htpasswd auth; there is no host `:5000` listener and no `kubectl port-forward`.
- **Rust compiler cache:** Rust/WASM compiles are wrapped by pinned `sccache`. Authorized local builds, Hive, and trusted Main use authenticated SeaweedFS S3 at `https://sccache.dev.nokey.sh` (path-style, bucket `nook-sccache`) when their scoped writer credentials exist. Explicit Remote tasks use a separate read/list-only identity for the same bucket, so they reuse trusted compiler objects but cannot publish branch-controlled objects. New Remote dependency results persist in task-scoped Zot OCI layers; trusted Main/local/Hive builds publish new compiler objects. Traefik terminates publicly trusted TLS on `:443` and forwards only to loopback SeaweedFS S3 (`127.0.0.1:8333`). Runtime Docker commands and compiler vertices mount stable secret IDs, and secret values do not participate in BuildKit cache checksums. PR and other arbitrary-ref delivery jobs receive no S3 credentials.

**Main seeds BuildKit cache visibility.** Main alone refreshes the shared Rust, WASM, web, and e2e refs under `nook/buildcache/**`; every PR job is read-only so branch generations cannot poison the authoritative Main lineage. Explicit Remote tasks write OCI cache images only under `nook/remote-buildcache/**` with a separate Zot identity that can read but cannot update Main's repository path. Every Remote ref is scoped by both branch and dispatched task, so independent tasks run in parallel without replacing another graph. Inactive Remote refs expire after seven days. Zot deduplicates identical content-addressed layer blobs across both paths. Main clients authenticate with `NOOK_REGISTRY_USERNAME` / `NOOK_REGISTRY_PASSWORD`; Remote uses `NOOK_REGISTRY_REMOTE_USERNAME` / `NOOK_REGISTRY_REMOTE_PASSWORD` and the read-only SeaweedFS identity.

Docker bake orchestration is app-owned: `nook-app/Taskfile.yml` passes `nook-app/docker-bake.hcl` plus package-local bake files under `nook-app/**/docker-bake.hcl` to `docker buildx bake`, while the root `Taskfile.yml` includes those app commands for repo-root usage. The Taskfile passes bake files as absolute paths, grants buildx read access to the repo root, and sets every source target context to the repo root so local and hosted-runner buildx versions resolve paths the same way. During the host handoff it grants write access only to the current commit/invocation artifact directory, then read access only to that directory for the web solve. The main Docker build context remains the repository root, so the sealed app image can copy root workflow files (`Taskfile.yml`, `.task/agentic-ai.yml`, docs, and CI helper scripts) as well as `nook-app`.

### Docker cache model

Nook does not use named volumes for `target/`, Cargo registries, or
`node_modules`: those correctness-relevant build inputs stay in normal image
layers and the selected builder's local content store. The cache-service
exception is SeaweedFS S3-backed `sccache`: authorized local runtime builds,
Hive, trusted Main, and explicit Remote tasks can use the authenticated HTTPS
endpoint. Main writes while Remote reads through separate identities; PR and other
arbitrary-ref delivery jobs bypass sccache.

| What                    | How it is cached                                                                                                                                                                                                                                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rust/web/browser layers | Local commands reuse the selected builder's store. Hosted CI persists stable Rust dependencies, separate source-sensitive native/WASM snapshots, and separate web-dependency, browser-free-web, and e2e-web refs on `registry.dev.nokey.sh` via BuildKit `type=registry`. Every exporter uses `mode=max`. |
| Rust crate dependencies | **cargo-chef** release WASM cooks plus a manifest-keyed release test warm-up, then a source-sensitive `cargo build --tests --release` sibling that matches `wasm-pack test`'s unit graph (dev-dependencies differ from `wasm-pack build --lib`). Dummy-root warm-ups cover native nextest/clippy/coverage. Hosted Main publishes the authoritative layers for read-only PR restores and may additionally reuse compiler objects from Main's SeaweedFS bucket; explicit Remote tasks publish new branch results only to their task-scoped Zot refs. |
| SeaweedFS S3 compiler cache | `task sccache:ensure` verifies authenticated S3 when `.nook/cache/sccache-access-key` and `sccache-secret-key` exist and otherwise reports that sccache is disabled. Trusted Main uses the authoritative read/write identity; explicit Remote tasks use separate `NOOK_SCCACHE_REMOTE_*` read-only credentials for `nook-sccache`. PR and other arbitrary-ref jobs receive neither identity. `task sccache:stats` reports the full object count and byte size. `task infra:sccache:check` verifies anonymous denial, Main read/write, and Remote read-only access. |
| OCI registry (`registry.dev.nokey.sh`) | Zot in k0s with retained `/var/lib/hive/zot`, ClusterIP `10.96.90.10:5000`, Traefik HTTPS + htpasswd under `*.dev.nokey.sh`. Hosted CI and Hive use it for BuildKit cache and image publish/pull. No host `:5000` mapping and no `kubectl port-forward`. |
| Server mesh | `task infra:mesh:node:add` idempotently enrolls a distinct, non-HA Linux server as a Cloudflare Mesh node for direct private-IP connectivity. The silent Task obtains the one-time connector token from the existing Wrangler OAuth session and streams it only to a mode-`0700` root helper over SSH stdin. Enrollment refuses active kernel auditing, temporarily hides root process arguments from unprivileged users, restores `/proc`, removes the helper, and never persists or logs the token. Subnet routes and HA replicas remain explicit later changes. |
| `nook-app/target/`      | Lives at `/meta-secret/nook/nook-app/target` in the Rust lineage only. Hosted CI persists its reachable BuildKit layers in private Zot refs; it remains absent from `nook-web:local`. |
| `nook-app/nook-web/nook-web-app/node_modules` | Installed directly in the `web-deps` Dockerfile layer (parallel branch, local immutable layer like `builder-deps`), with no host/daemon cache mount. `web:dev` (mounted) runs `bun install` in its command. |
| Web wasm pkg + coverage | Generated in `builder-wasm`, exported from a scratch target under `${TMPDIR}/nook-web-artifacts/<commit>/<invocation>/`, then consumed as a small named context by the web solve. |
| Web dist                | Built at **nook-web image build time** (`bun run build`, channel URL args) so it is present in every container: PR previews deploy the combined internal harness plus three isolated native Pages aliases, main deploys isolated site/Simple/Sentinel artifacts to their stable development origins, and release publishes the extracted production artifacts. |
| Playwright Chromium     | Pre-installed only in `web-e2e-base`; absent from the normal PR `web-base` and Rust lineage. `ci:full-e2e` PRs and Main use the e2e base; browser-only WASM tasks use the on-demand Rust browser image. |
| CI Docker builds        | PR CI builds verified WASM once and uploads its small generated package for parallel preview and `ci:full-e2e` consumers. Independent web and extension e2e consumers each build only the Chromium web image from that artifact and run on separate hosted runners; the extension job owns the shared e2e cache export while web restores it without duplicating that upload. Changed PR demo specs and Main's complete demo project retain 90-day Actions artifacts; the 10 largest WebMs per run are best-effort published into one private Linear `nook-ui` issue per PR. Main serializes native → WASM → web cache-writing lanes: each verifies read-only and then exports its already-solved local graph, with isolated no-import WASM dependency publication. Parallel web e2e / extension e2e / UI demo consumers rebuild from the verified WASM handoff and remain read-only; deploy waits on web verify + web e2e only. Main also publishes commit-keyed Rust coverage; a dedicated PR reporting job reuses trusted exact-commit artifacts when available and never cold-builds the base revision. |

Regenerate chef inputs after dependency changes: commit **`nook-app/Cargo.lock`** when dependencies change; `recipe.json` is produced during `docker build`.

### Sealed-image consequences

- **Write-type tasks emit diffs, not host writes.** Web formatting runs in `nook-web:local`; Rust formatting and coverage updates run in `nook-rust:local`. Both source-sealed images print a `git diff` rather than mutating the host tree.
- **`task format` always host-applies.** The agent/developer entrypoint runs sealed format and applies the unified diff to the working tree. Use it unconditionally before every push. `task format:diff` prints without applying (debug only). `task extension:format` formats inside the sealed image and discards the result — never use it alone before push.
- **`dist` hand-off.** PR CI keeps the combined `dist` tree as an internal harness and independently deploys `dist/site`, Simple, and Sentinel to each project's `pr-<number>` branch alias; its GitHub deployment points at the isolated site. Main deploys the same artifacts independently, with the landing and both vault domains targeting their projects' `development` branch aliases. Release extracts production artifacts with `task docker:extract:dist`.

### Build & verify

- **Native linking:** `nook-app/.cargo/config.toml` uses **mold** for `x86_64-unknown-linux-gnu` only (installed in `rust-base`); wasm32 targets keep the default linker.
- **Wasm:** `builder-wasm` compiles the featureless `nook-wasm` vault bridge and tiny `nook-companion-wasm` (content heuristics + host policy), then runs `wasm-pack` for both. Vault apps and extension background/popup share `nook-wasm`; content scripts load only the companion package. Immutable Rust-owned application configuration and manager capability checks enforce the active realm on the vault package. Both packages cross the host artifact boundary (companion nested under the vault handoff) and are seeded into the web image. Mounted local-iteration paths regenerate them from the on-demand Rust image. `WASM_BUILD_MODE=dev` is the default and skips `wasm-opt`; PR/main CI use dev mode, while release passes `WASM_BUILD_MODE=prod` explicitly.
- **Verify:** GitHub Actions `pr.yml` / `task check` (fmt, clippy,
  `task rust:coverage:check`, svelte-check, eslint, vitest, vite build) using the
  default dev/no-opt WASM mode unless `WASM_BUILD_MODE=prod` is set. Agents
  require only `task format` locally; product verification runs on Actions.

## 8. Hive isolated agent platform

Hive lives in `agentic-ai/minds/hive` and is deployed only through the
domain-owned Hive commands flattened into the `infra/Taskfile.yml` command
surface for the dedicated k0s host. It is a
stateful platform built from persistent Neo4j coordination and disposable
Kata-backed execution Pods:

- a token-free dispatcher reconciles trusted Main-failure Workbench incidents;
- Neo4j owns the DAG, readiness, claims, leases, attempts, results, and bounded
  Git-patch artifacts;
- a four-replica `kata-dragonball` pool gives every task a separate guest
  kernel and one embedded Codex thread;
- Hive treats its Codex agents as trusted operators and gives Main-repair
  agents a repository-scoped GitHub credential for standard `git` and `gh`
  delivery; custom publication brokers or mailbox protocols must not be added
  solely to hide that credential from the agent;
- the coordinator and authentication services remain only where they provide
  durable coordination or Codex-session lifecycle behavior, not as a general
  distrust boundary around the agent;
- the worker image carries the native Rust, Bun, Node, and Task toolchain, so
  mandatory `task format` runs directly in the Kata guest without any Docker
  daemon or socket; and
- the task is not complete until its normal PR is checked, reviewed,
  squash-merged, its resulting Main state is green, and Workbench is updated.

See
[design-docs/hive-isolated-agent-platform.md](design-docs/hive-isolated-agent-platform.md)
for the complete component model, task lifecycle, trust boundaries, recovery
semantics, cache topology, and deployment command surface.
