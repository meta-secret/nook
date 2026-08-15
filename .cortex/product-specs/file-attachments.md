# File Attachments

## Relationships

- [Product Specifications Index](index.md)
  - Catalogs the product specifications and their current status.
  - Read when this document touches the related product behavior or user flow.
- [Nook Password Manager Specification](password-manager.md)
  - Defines the core vault product, user flows, storage formats, cryptography, and UI boundaries.
  - Read when this document touches the related product behavior or user flow.
- [Nook Coding Rules & Golden Principles](../rules.md)
  - Defines the repository-wide implementation, testing, tooling, and delivery constraints.
  - Apply throughout implementation and review.

## Document map

- [Overview](#overview)
  - Adds files as typed encrypted vault items.
  - Read first to understand the scope and intent of Overview.
- [Goals](#goals)
  - Let users upload a file and store it as an encrypted vault secret.
  - Read first to understand the scope and intent of Goals.
- [Product model](#product-model)
  - Wire tag: file-attachment.
  - Read before changing or relying on Product model.
- [UI and security](#ui-and-security)
  - Type picker entry creates a form with optional title and a file input.
  - Read before changing the security or key boundary described by UI and security.
- [Out of scope (for now)](#out-of-scope-for-now)
  - Importing provider attachments (1Password / Proton Pass still skip attachments).
  - Read before expanding the product boundary beyond Out of scope (for now).
- [Status](#status)
  - Records the implemented attachment status.
  - Read when assessing the current state of Status.

## Overview

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
