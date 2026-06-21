# Nook Password Manager Specification

This document defines the functional and technical specifications for Nook's Zero-Knowledge Password and Secret Manager.

---

## 1. Product Overview & Goals

The Nook Password Manager is a client-side, zero-knowledge secret vault. It enables users to secure and organize credentials locally in their browser or synchronize them to their private GitHub repositories.

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

### A. Configuration & Authentication Flow
1. **Target Selection:** The user chooses between `local` (IndexedDB) and `github` storage mode.
2. **Configuration Entry:**
   - **Local Mode:** No credentials required. Click **Connect vault**.
   - **GitHub Mode:** Requires only a GitHub Personal Access Token (PAT) with `repo` scope. The repository (`{username}/nook`) and vault file (`nook-vault.yaml`) are resolved automatically from the PAT.
3. **Encryption Key (auto-managed):**
   - On first connect, a random 128-bit encryption key is generated and stored in IndexedDB under key `vault_secret_key` (via `rexie`).
   - The key never leaves the browser and is never stored on GitHub.
   - GitHub only stores the encrypted vault file (YAML with per-record armored ciphertext).
4. **Vault Connection:**
   - The user clicks **Connect vault**.
   - Rust validates storage mode and PAT (GitHub mode) before I/O.
   - If the vault file is found, it is loaded, parsed, and secret **values** are decrypted into an in-memory session.
   - If no vault file is found (404 from GitHub or empty IndexedDB), an empty vault is initialized automatically (GitHub) or starts empty (local).
   - Upon successful connection, storage mode and GitHub PAT are saved to `localStorage` for session convenience.

### B. Managing Vault Secrets
1. **Secrets List:** Plaintext secrets are listed alphabetically by key (service name).
2. **Search / Filter:** A search bar filters secrets in real-time. Filtering runs in `nook-core` (`filter_secrets`) via WASM — labels only, case-insensitive substring match.
3. **Secret Visibility Toggle:** Secret values are masked as dots by default. Users can toggle reveal per row.
4. **Copy to Clipboard:** Browser clipboard API (UI-only).
5. **Adding Secrets:**
   - The user enters a key (label) and value.
   - Rust validates non-empty label (trimmed) and non-empty value.
   - Clicking **Save Secret** inserts into the in-memory session, encrypts **only the changed record**, updates the armored cache, serializes to YAML, and writes to storage.
6. **Deleting Secrets:**
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
secrets:
  - key: github.com
    value: |
      -----BEGIN AGE ENCRYPTED FILE-----
      ...
      -----END AGE ENCRYPTED FILE-----
  - key: work-vpn
    value: |
      -----BEGIN AGE ENCRYPTED FILE-----
      ...
      -----END AGE ENCRYPTED FILE-----
```

- **`key`:** Plaintext label (visible on disk).
- **`value`:** Armored age ciphertext of the secret value only (YAML `|` block scalar for multiline armor).
- **Legacy JSONL on-disk format** is still supported on load (`from_stored_auto` / format detection). New saves always use YAML.

Example fixtures: `nook-core/fixtures/` (generate via `cargo run --example generate_vault_fixtures -p nook-core`).

### C. Local Storage Adapter (IndexedDB)
- **Database Name:** `nook_db`, version `1`, store `vault`
- **Records:**
  - `vault_secret_key` — hex-encoded 128-bit random age passphrase (never synced to GitHub).
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
- **Key generation:** 128-bit random key via `getrandom`, stored as hex in `vault_secret_key`.
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

All format, crypto, validation, and generator behavior must be covered by Rust tests (`cargo test -p nook-core`). Integration workflows live in `nook-core/tests/vault_workflow.rs`.

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
