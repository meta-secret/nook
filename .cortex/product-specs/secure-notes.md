# Secure Notes

Add **secure notes** as a first-class vault item type alongside login, API key, and seed phrase.

## Goals

- Store free-form text (recovery instructions, PINs, license keys, misc secrets) with a title and optional tags.
- Reuse the existing typed-secret pipeline: `SecretType` variant, YAML payload, age-encrypted value, site grouping in the vault UI.
- Match add-item and detail-row patterns from other item types (reveal toggle, copy, delete).

## Scope (draft)

| Area | Notes |
|---|---|
| Core (`secret_types.rs`) | `SecretType::SecureNote`, `SecureNoteSecret { title, note }` |
| Wasm bridge | Serialize/deserialize + validation in Rust |
| Web UI | Type picker entry, add form, `SecretDetailRow` rendering |
| E2E | Add/save/search/delete smoke test |

## Out of scope (for now)

- Rich text / attachments
- Per-note encryption settings separate from vault keys

## Status

Draft — implementation tracked on branch `feat/secure-notes`.
