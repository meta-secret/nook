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
| Web UI | Type picker entry, add form, `SecretDetailRow` rendering (reveal, copy, delete — **no edit**) |
| E2E | Add/save/search/delete smoke test |

## Corrections (no edit)

Vault secrets are **append-only** in the UI: add, reveal, copy, delete. There is no edit-in-place for any item type (including secure notes).

To change a note (or any secret), the intended flow is:

1. Add a new item with the corrected content (new random id).
2. Delete the obsolete item.

These two steps should eventually be one atomic **`replace_secret`** operation in `nook-wasm` (add + delete, single `save_current_db`) so a failed write cannot leave duplicate or half-updated state. Until that exists, users add then delete manually; the UI must not imply that row content is editable.

## Out of scope (for now)

- In-place edit UI for vault items
- Rich text / attachments
- Per-note encryption settings separate from vault keys

## Status

Draft — implementation tracked on branch `feat/secure-notes`.
