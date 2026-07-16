# Nook Password Manager Specification

This document defines the functional and technical specifications for Nook's Zero-Knowledge Password and Secret Manager.

---

## 1. Product Overview & Goals

The Nook Password Manager is a client-side, zero-knowledge secret vault. It enables users to secure and organize credentials locally in their browser or synchronize them to their private GitHub repositories.

The product promise is: **Your device is the key.** There is no master password;
approved devices unlock the vault. Nook provides passwordless access to your
secrets while keeping the model decentralized: your secrets, your storage, your
keys.

### Core Goals
- **Zero-Knowledge Architecture:** Plaintext credentials and encryption keys must never leave the user's browser or be sent over the wire in unencrypted form.
- **Stateless UI:** The frontend components act only as a view shell. All state mutation, serialization, validation, password generation, and cryptographic operations are encapsulated in Rust (`nook-core` + `nook-wasm`).
- **Portable Backends:** Support local browser storage (IndexedDB) and remote git-backed repositories (GitHub API) with a unified connection flow.
- **Age Compatibility:** Secret values are armored age ciphertext. Vault projections and event files are human-readable YAML.

---

## 2. Detailed User Flows

```
      +--------------------+
      | 1. Config & Login  | <---+ (Decryption fails / Key mismatch)
      +--------------------+     |
                |                |
                v (Success)      |
      +--------------------+     |
      |  2. Secret Vault   | ----+
      +--------------------+
                |
                v
      +--------------------+
      |3. Password Gen/Sync|
      +--------------------+
```

### A. Login & Storage Provider Flow
1. **Device protection gate:** Before provider credentials or device keys are loaded, the user creates or authorizes passkey-backed WebAuthn PRF protection, or a local PIN fallback when PRF is unavailable. A backup password may instead unwrap a local vault directly; that path does not load the protected device identity or its sealed provider credentials.
2. **Login gate (vault locked):** If no saved providers exist, the user sees a provider list (Local, GitHub). This is the primary entry point — not a settings page.
3. **First-time setup:** User picks a storage provider. GitHub requires a one-time PAT entry; local needs no credentials. On successful connect, the provider (including a device-sealed GitHub PAT) is saved to IndexedDB (`nook_auth`). The vault is created with **device keys** as the default unlock method.
4. **Return visits:** The login gate shows device keys (default) and any labelled backup passwords. Device-key unlock requests passkey/PIN authorization; backup-password unlock opens the local vault directly. After device authorization, the vault may auto-unlock when device keys work. See [auth-providers.md](../design-docs/auth-providers.md) §3.
5. **Authenticated navigation:** **Vault** lists saved items. **Onboard** is a standalone page that generates a QR/link from two dropdowns: auth provider and vault password. **Settings** lists storage providers, reconnect, and vault password management.
6. **Encryption keys (auto-managed):** Before first connect, the user creates passkey-PRF protection or, when PRF is unavailable, a local PIN wrapper. Rust/WASM derives the AES key and stores the device private key as `device_identity_wrapped`. On connect, vault keys are generated and written to the vault file. GitHub only stores the encrypted vault file.
7. **Vault connection:** Rust validates storage mode and PAT before I/O, loads/decrypts the vault, or initializes empty storage.
8. **Future:** Sync providers replicate one local vault with version-based reconciliation — see [unified-vault.md](../design-docs/unified-vault.md).

### B. Managing Vault Secrets
1. **Secrets List:** Plaintext secrets are listed alphabetically by key (service name).
2. **Search / Filter:** A search bar filters secrets in real-time. Filtering runs in `nook-core` (`filter_secrets`) via WASM — labels only, case-insensitive substring match.
3. **Secret Visibility Toggle:** Secret values are masked as dots by default. Users can toggle reveal per row.
4. **Copy to Clipboard:** Browser clipboard API (UI-only).
5. **Adding Secrets:**
   - The user enters a key (label) and value.
   - Rust validates non-empty label (trimmed) and non-empty value.
   - Clicking **Save Secret** inserts into the in-memory session, encrypts **only the changed record**, updates the armored cache, serializes to YAML, and writes to storage.
6. **No in-place edit:** Vault items are **immutable** after save. There is no edit form or `update_secret` in the UI. To fix a mistake or update content, the user **adds a new item and deletes the old one**. A future `replace_secret(old_id, new_item)` WASM call should perform add + delete in a **single** `save_current_db` so storage never holds duplicates if the second step fails mid-flight.
7. **Deleting Secrets:**
   - Removes the record from session and armored cache, re-serializes YAML, and saves — no full-vault re-encryption.
8. **Importing from Bitwarden:**
   - The user selects a plaintext Bitwarden JSON export in the browser.
   - Rust parses the export and maps Bitwarden login items to Nook logins and Bitwarden secure-note items to Nook secure notes. Cards, identities, SSH keys, and other unsupported types are counted and skipped.
   - Exact values already in the active vault are counted and skipped so repeating the same import is idempotent.
   - WASM encrypts every accepted item and appends all `SecretCreated` operations in one signed event. The plaintext export is never persisted or logged by Nook.

### C. Cryptographically Secure Password Generator
1. **Options Panel:** Located alongside the addition form.
2. **Parameters:**
   - **Length Slider:** Range 8–64 in UI (Rust accepts 8–128 via `PasswordOptions`).
   - **Character Sets:** Lowercase, uppercase, numbers, symbols.
3. **Generation:** Implemented in `nook-core` (`generate_password`) using `getrandom`. Exposed via `NookVaultManager.generate_password`. UI only calls WASM and populates the value field.

---

## 3. Database Schema & File Formats

### A. In-Memory Plaintext Layout (typed Database session)
The WASM session holds a typed Rust `Database` of plaintext `SecretRecord`
values. It is never represented as a serialized text format inside the app
session.

- **Sorting:** `Database::list()` returns records sorted lexicographically by id.
- **Scope:** In-memory only — never written to GitHub or IndexedDB as plaintext.

### B. Local Projection Layout (YAML)
Path: browser-local `nook-projection.yaml` projection cache (IndexedDB `vault:{store_id}`).

```yaml
vault_version: 1
store_id: store_SMypl8K0w9Y
secrets:
  - id: secret_k9Qx2mNp4Rt
    type: api-key
    data: |
      -----BEGIN AGE ENCRYPTED FILE-----
      ...
      -----END AGE ENCRYPTED FILE-----
```

- **`store_id`:** Logical secret-store identity (`store_{token}`). Same value on every provider replica. See [secret-store-identity.md](../design-docs/secret-store-identity.md).
- **`vault_version`:** Local projection revision. Provider sync uses immutable event heads — see [vault-event-log.md](../design-docs/vault-event-log.md).
- **`id`:** Secret item id — generated items use `secret_{token}`; legacy human labels still load.
- **`data`:** Armored age ciphertext of the secret value only (YAML `|` block scalar for multiline armor).
Example fixtures: `nook-app/nook-core/fixtures/` (generate via `cd nook-app && cargo run --example generate_vault_fixtures -p nook-core`).

### C. Local Storage Adapter (IndexedDB)
- **Database Name:** `nook_db`, version `1`, store `vault`
- **Records:**
  - `device_identity_wrapped` — versioned AES-256-GCM-wrapped age X25519 identity plus WebAuthn PRF or PIN metadata (never synced).
  - `device_identity_secret` — legacy plaintext record, deleted after successful passkey migration.
  - `device_id` — short fingerprint for UI.
  - `vault:{store_id}` — local projection cache for one vault.
  - Values are UTF-8 YAML text.

### D. GitHub Repository Adapter
- **Repository:** `{username}/nook` (auto-created if missing).
- **Event Path:** `nook-log/v1/events/{base64url_sha256_digest}.yaml`
- **Endpoint:** `https://api.github.com/repos/{username}/nook/contents/nook-log/v1/events/{base64url_sha256_digest}.yaml`
- **Authentication:** `Authorization: Bearer {pat}`
- **Encoding:** Event content is pretty-printed UTF-8 YAML; GitHub API stores base64 in transit.
- **Concurrency:** Append-only `put_event_if_absent`; existing identical content is idempotent and different content at the same event id is corruption.

---

## 4. Cryptographic Specifications

- **Per-record encryption:** Each secret **value** is independently encrypted. Labels stay plaintext in the vault file.
- **Format:** Age ASCII armor (`age` crate with `armor` feature).
- **Session crypto:** `VaultCrypto` in `nook-core` derives scrypt identity/recipient once per connect and reuses them.
- **Work factor:** New encryptions use scrypt `N = 2^15` (`PROGRAMMATIC_SCRYPT_LOG_N`) because the vault key is high-entropy random hex, not a human passphrase. Existing records decrypt using the factor embedded in each age stanza.
- **Key generation:** 32-byte random DEC via `generate_dec()`; distributed per-device in vault `auth:` section.
- **Incremental save path:** WASM keeps `stored_armored: HashMap<key, armored_value>`. Saves serialize the cache to YAML without re-encrypting unchanged records.

### Vault access diagnostics

Nook exposes a Rust-owned diagnostic report for explaining encrypted vault
access without exposing plaintext secrets or key material. The report uses the
same `auth:` envelope parsing, device identity, and `secrets_key` decrypt path
as normal unlock, then returns only safe metadata:

- opaque, non-sensitive device/session identifiers and key-access status
  (`enrolled_decryptable`, `auth_row_missing`, `join_pending`,
  `device_identity_mismatch`, `envelope_decrypt_failed`,
  `unsupported_epoch`, or `corrupt_ciphertext`);
- auth key ids that have vault-key envelopes;
- per-secret decryptability status and explanation;
- current/known key epochs and event-payload epoch status when the event log is
  available.

Diagnostics never return `secrets_key`, `members_key`, private device identity,
passkey PRF output, password material, decrypted secret values, or identifiers
derived from private device identity or vault keys. Sync-provider credentials
remain outside the report because providers only replicate encrypted data; they
do not grant vault access.

---

## 5. Rust Domain Modules (`nook-core`)

| Module | Responsibility |
|--------|----------------|
| `lib.rs` / `Database` | Typed in-memory session, stored vault encrypt/decrypt |
| `vault_format.rs` | YAML serialization and parsing |
| `vault_crypto.rs` | Session-scoped age encrypt/decrypt |
| `validation.rs` | Connect/secret validation, search filter |
| `password.rs` | CSPRNG password generation |

All format, crypto, validation, and generator behavior must be covered by Rust tests (`task rust:test`). Integration workflows live in `nook-app/nook-core/tests/vault_workflow.rs`.

---

## 6. TypeScript / UI Boundaries

**Belongs in Rust (not TS/Svelte):**
- Vault serialization (YAML)
- Encrypt/decrypt
- Password generation
- Secret label/value validation
- Connect/PAT validation
- Secret search/filter

**Belongs in UI only:**
- Tab navigation, loading spinners, toast messages
- `localStorage` for storage mode + PAT convenience
- Clipboard, reveal/hide, form bindings
- `requestAnimationFrame` yield before blocking WASM crypto (paint "Saving…")
