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
- **Age Compatibility:** Secret values are armored age ciphertext. Vault files are human-readable YAML (or legacy JSONL on load).

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
1. **Login gate (vault locked):** If no saved providers exist, the user sees a provider list (Local, GitHub). This is the primary entry point — not a settings page.
2. **First-time setup:** User picks a storage provider. GitHub requires a one-time PAT entry; local needs no credentials. On successful connect, the provider (including GitHub PAT) is saved to IndexedDB (`nook_auth`) and never re-prompted on return visits. The vault is created with **device keys** as the default unlock method.
3. **Return visits:** When one saved provider exists and device keys work, the vault may auto-unlock on load. Otherwise the login gate shows a **two-step unlock form**: (1) storage provider, (2) unlock method — device keys (default) or a labelled backup password when the vault has `password_entries`. See [auth-providers.md](../design-docs/auth-providers.md) §3.1.
4. **Authenticated navigation:** **Vault** lists saved items. **Onboard** is a standalone page that generates a QR/link from two dropdowns: auth provider and vault password. **Settings** lists storage providers, reconnect, and vault password management.
5. **Encryption keys (auto-managed):** On first connect, vault keys are generated and written to the vault file. Device private key stays in IndexedDB (`device_identity_secret`). GitHub only stores the encrypted vault file.
6. **Vault connection:** Rust validates storage mode and PAT before I/O, loads/decrypts the vault, or initializes empty storage.
7. **Future:** Sync providers replicate one local vault with version-based reconciliation — see [unified-vault.md](../design-docs/unified-vault.md).

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

### C. Cryptographically Secure Password Generator
1. **Options Panel:** Located alongside the addition form.
2. **Parameters:**
   - **Length Slider:** Range 8–64 in UI (Rust accepts 8–128 via `PasswordOptions`).
   - **Character Sets:** Lowercase, uppercase, numbers, symbols.
3. **Generation:** Implemented in `nook-core` (`generate_password`) using `getrandom`. Exposed via `NookVaultManager.generate_password`. UI only calls WASM and populates the value field.

---

## 3. Database Schema & File Formats

### A. In-Memory Plaintext Layout (JSONL session)
The WASM session holds a UTF-8 JSONL string (`decrypted_jsonl`). Each line is one plaintext record:

```json
{"key":"github.com","value":"ghp_SecretToken123"}
{"key":"gmail.com","value":"my_secure_password_99"}
```

- **Sorting:** Lines sorted lexicographically by `key`.
- **Scope:** In-memory only — never written to GitHub or IndexedDB as plaintext.

### B. On-Disk Vault Layout (YAML — default)
Path: `nook-vault.yaml` (GitHub and IndexedDB `encrypted_db`).

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
- **`vault_version`:** Monotonic revision counter incremented on every save. Used for sync reconciliation — see [unified-vault.md](../design-docs/unified-vault.md).
- **`id`:** Secret item id — generated items use `secret_{token}`; legacy human labels still load.
- **`data`:** Armored age ciphertext of the secret value only (YAML `|` block scalar for multiline armor).
- **Legacy JSONL on-disk format** is still supported on load (`from_stored_auto` / format detection). New saves always use YAML.

Example fixtures: `nook-core/fixtures/` (generate via `cargo run --example generate_vault_fixtures -p nook-core`).

### C. Local Storage Adapter (IndexedDB)
- **Database Name:** `nook_db`, version `1`, store `vault`
- **Records:**
  - `device_identity_secret` — age X25519 identity (never synced).
  - `device_id` — short fingerprint for UI.
  - `encrypted_db` — local copy of vault YAML (local storage mode).
  - `encrypted_db` — UTF-8 text of the on-disk vault file (YAML).

### D. GitHub Repository Adapter
- **Repository:** `{username}/nook` (auto-created if missing).
- **File Path:** `nook-vault.yaml`
- **Endpoint:** `https://api.github.com/repos/{username}/nook/contents/nook-vault.yaml`
- **Authentication:** `Authorization: Bearer {pat}`
- **Encoding:** File content is UTF-8 YAML; GitHub API stores base64 in transit.
- **Optimistic concurrency:** Blob SHA cached on load and sent on PUT.

---

## 4. Cryptographic Specifications

- **Per-record encryption:** Each secret **value** is independently encrypted. Labels stay plaintext in the vault file.
- **Format:** Age ASCII armor (`age` crate with `armor` feature).
- **Session crypto:** `VaultCrypto` in `nook-core` derives scrypt identity/recipient once per connect and reuses them.
- **Work factor:** New encryptions use scrypt `N = 2^15` (`PROGRAMMATIC_SCRYPT_LOG_N`) because the vault key is high-entropy random hex, not a human passphrase. Existing records decrypt using the factor embedded in each age stanza.
- **Key generation:** 32-byte random DEC via `generate_dec()`; distributed per-device in vault `auth:` section.
- **Incremental save path:** WASM keeps `stored_armored: HashMap<key, armored_value>`. Saves serialize the cache to YAML without re-encrypting unchanged records.

---

## 5. Rust Domain Modules (`nook-core`)

| Module | Responsibility |
|--------|----------------|
| `lib.rs` / `Database` | In-memory JSONL session, stored vault encrypt/decrypt |
| `vault_format.rs` | YAML + JSONL serialization, format detection |
| `vault_crypto.rs` | Session-scoped age encrypt/decrypt |
| `validation.rs` | Connect/secret validation, search filter |
| `password.rs` | CSPRNG password generation |

All format, crypto, validation, and generator behavior must be covered by Rust tests (`task rust:test`). Integration workflows live in `nook-core/tests/vault_workflow.rs`.

---

## 6. TypeScript / UI Boundaries

**Belongs in Rust (not TS/Svelte):**
- Vault serialization (YAML/JSONL)
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
