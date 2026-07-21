# File Attachments

Add **file attachments** as a first-class vault item type alongside login, API
key, seed phrase, secure note, authenticator, and passkey.

## Goals

- Let users upload a file and store it as an encrypted vault secret.
- Reuse the typed-secret pipeline: `SecretType` tag, YAML payload, age-encrypted
  value, list/detail UI patterns from other item types.
- Keep binary content out of list projections; only reveal bytes on explicit
  decrypt/download.

## Product model

- Wire tag: `file-attachment`.
- Plaintext payload fields (camelCase YAML):
  - `title` — display title (defaults to the file name when empty at create time)
  - `fileName` — original file name (no path separators)
  - `mimeType` — MIME type (`application/octet-stream` when the browser omits one)
  - `sizeBytes` — decoded byte length (must match content)
  - `contentBase64` — standard base64 of the raw file bytes
- Maximum decoded size: **1 MiB** (`FILE_ATTACHMENT_MAX_BYTES`). Rust rejects
  larger payloads; the web form pre-checks the same limit.

## UI and security

- Type picker entry creates a form with optional title and a file input.
- Vault list shows title/file name/size/MIME metadata only.
- Expanding an item and revealing it unlocks **Download file**, which rebuilds a
  browser `Blob` from the decrypted base64 content.
- File bytes must never be logged.

## Out of scope (for now)

- Importing provider attachments (1Password / Proton Pass still skip attachments)
- Multi-file items or folders
- Streaming/chunked encryption for large files
- Preview of file contents inside the vault UI

## Status

Active — implemented with Rust validation, WASM form builders, and Simple Vault
upload/download UI.
