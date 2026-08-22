# Secure Notes

## Overview

Add **secure notes** as a first-class vault item type alongside login, API key, and seed phrase.

## Goals

- Store free-form text such as recovery instructions, PINs, and license keys
  under a user-visible title.
- Reuse the existing typed-secret pipeline: `SecretType` variant, YAML payload, age-encrypted value, site grouping in the vault UI.
- Match add-item and detail-row patterns from other item types (reveal toggle, copy, delete).

## Implemented scope

- **Core**
  - `SecretType::SecureNote` identifies the item.
  - `SecureNoteSecret { title, note }` owns the plaintext payload.
- **WASM bridge**
  - Rust owns serialization, deserialization, and validation.
- **Web UI**
  - The type picker opens the secure-note editor.
  - The vault renders list and detail states.
  - Users can reveal, copy, edit, and delete a note.
- **Imports**
  - Bitwarden, 1Password, LastPass, Proton Pass, Dashlane, Keeper, and
    KeePassXC exports may produce secure notes.
  - Re-importing the same supported item is idempotent.

## Editing behavior

The vault UI opens an existing secure note in edit mode. Saving calls the
Rust-owned `replace_secret` operation through `nook-wasm`.

Replacement keeps mutation, validation, encryption, and persistence on the
Rust/WASM side. TypeScript and Svelte own the editor lifecycle and rendering,
not replacement policy.

## Executable scenarios

- Rust tests own validation, encrypted replacement, and safe list projection.
- Playwright creates and previews Markdown, reveals the note, edits it through
  the Rust replacement path, reloads the vault, and verifies the replacement
  persisted.
- Import scenarios verify supported providers and duplicate reconciliation.
- Short-viewport coverage keeps editing usable above a mobile keyboard.

## Out of scope (for now)

- Rich text / attachments
- Per-note encryption settings separate from vault keys

## Status

Implemented across the Rust domain, WASM bridge, Simple Vault UI, imports, and
targeted tests.
