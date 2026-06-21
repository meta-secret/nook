# Nook Password Manager Specification

This document defines the functional and technical specifications for Nook's Zero-Knowledge Password and Secret Manager.

---

## 1. Product Overview & Goals

The Nook Password Manager is a client-side, zero-knowledge secret vault. It enables users to secure and organize credentials locally in their browser or synchronize them to their private GitHub repositories.

### Core Goals
- **Zero-Knowledge Architecture:** Plaintext credentials and master passphrases must never leave the user's browser or be sent over the wire in unencrypted form.
- **Stateless UI:** The frontend components act only as a view shell. All state mutation, serialization, and cryptographic operations are encapsulated in WebAssembly.
- **Portable Backends:** Support local browser storage (IndexedDB) and remote git-backed repositories (GitHub API) with a unified connection flow.
- **Rage/Age Compatibility:** Encrypted vaults must be standard age files, decryptable via standard command-line tools like `rage`.

---

## 2. Detailed User Flows

```
      +--------------------+
      | 1. Config & Login  | <---+ (Decryption fails / Wrong passphrase)
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
   - **Local Mode:** Requires only a Master Passphrase.
   - **GitHub Mode:** Requires a GitHub Personal Access Token (PAT), repository name (e.g. `username/repo`), target file path (e.g. `nook-secrets.age`), and a Master Passphrase.
3. **Vault Connection:**
   - The user clicks **Connect**.
   - If the database file is found, it is loaded, decrypted, and parsed.
   - If no database file is found (e.g. 404 from GitHub or empty IndexedDB), the UI displays a warning and prompts the user to **Initialize Empty Database**.
   - Upon successful connection, credentials are saved to `localStorage` for session convenience, and the user is redirected to the **Secret Vault** tab.

### B. Managing Vault Secrets
1. **Secrets List:** Plaintext secrets are listed alphabetically by key (service name).
2. **Search / Filter:** A search bar filters secrets in real-time by matching the query against keys.
3. **Secret Visibility Toggle:** Secret values (passwords) are masked as dots (`••••••••••••••••`) by default. Users can click the Eye/EyeOff toggle to mask/unmask individual values.
4. **Copy to Clipboard:** Clicking the Copy icon copies the secret value to the clipboard. The icon changes to a checkmark for 2 seconds to indicate success.
5. **Adding Secrets:**
   - The user enters a unique key (service/label) and a value (password).
   - Clicking **Save Secret** triggers an insert.
   - The updated database is sorted, formatted to JSONL, encrypted, and immediately written back to the storage target.
6. **Deleting Secrets:**
   - The user clicks the trash icon next to a secret.
   - The secret is removed, and the vault is serialized, encrypted, and saved to the storage backend.

### C. Cryptographically Secure Password Generator
1. **Options Panel:** Located alongside the addition form.
2. **Parameters:**
   - **Length Slider:** Range: 8 to 64 characters (default: 16).
   - **Character Sets:** Lowercase (`a-z`), Uppercase (`A-Z`), Numbers (`0-9`), and Symbols (`!@#$...`).
3. **Generation Trigger:**
   - Computes a random string using browser-native cryptographically secure random values (`window.crypto.getRandomValues`).
   - Automatically populates the password value field in the secret addition form.

---

## 3. Database Schema & File Formats

### A. In-Memory Plaintext Layout (JSONL)
The database payload is a UTF-8 string containing JSON Lines (JSONL). Each line represents one secret record with exact formatting:
```json
{"key":"github.com","value":"ghp_SecretToken123"}
{"key":"gmail.com","value":"my_secure_password_99"}
```
- **Sorting:** Lines are sorted lexicographically by `key` to ensure deterministic Git diffs.
- **Whitespace:** No extra newlines, indentations, or spaces are allowed at the line boundaries.

### B. Local Storage Adapter (IndexedDB)
- **Database Name:** `nook_db`
- **Version:** `1`
- **Store Name:** `vault`
- **Stored Record:**
  - Key: `encrypted_db`
  - Value: The age-encrypted database payload represented as a lowercase hex string.

### C. GitHub Repository Adapter
- **Endpoint:** `https://api.github.com/repos/{repo}/contents/{path}`
- **Authentication:** `Authorization: token {pat}` header.
- **Conflict Avoidance (SHA):**
  - During `connect`, the file's current Git blob SHA is cached.
  - During writes, this SHA is sent back to GitHub in the `sha` field of the PUT body to prevent overwriting concurrent updates.
  - On successful write, the new Git blob SHA returned in the response is cached for the next update.

---

## 4. Cryptographic Specifications

- **Encryption Format:** Age (specifically using standard scrypt key derivation and x25519-dalek under the hood).
- **Key Derivation (scrypt):**
  - Automatically derives keys using a salt generated during encryption.
  - Uses default parameters from the standard Rust `age` crate for scrypt (logN = 15, r = 8, p = 1), optimizing balance between safety and browser execution speed.
- **Passphrase Fallback:** If the passphrase is left blank, the system skips age encryption/decryption and operates on plaintext strings directly. This serves as a debugging feature and should not be used in production.
