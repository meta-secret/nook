# Secure Notes

## Overview

Add **secure notes** as a first-class vault item type alongside login, API key, and seed phrase.

## Goals

- Store free-form text such as recovery instructions, PINs, and license keys
  under a user-visible title.
- Reuse the existing typed-secret pipeline: `SecretType` variant, YAML payload, age-encrypted value, site grouping in the vault UI.
- Match add-item and detail-row patterns from other item types (reveal toggle, copy, delete).

## Implemented scope

| Area                     | Notes                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------- |
| Core (`secret_types.rs`) | `SecretType::SecureNote`, `SecureNoteSecret { title, note }`                        |
| Wasm bridge              | Serialize/deserialize + validation in Rust                                          |
| Web UI                   | Type picker, create/edit form, list and detail rendering, reveal, copy, and delete  |
| Tests                    | Rust validation and replacement coverage plus browser create/reveal/delete coverage |

## Editing behavior

The vault UI opens an existing secure note in edit mode. Saving calls the
Rust-owned `replace_secret` operation through `nook-wasm`.

Replacement keeps mutation, validation, encryption, and persistence on the
Rust/WASM side. TypeScript and Svelte own the editor lifecycle and rendering,
not replacement policy.

## Out of scope (for now)

- Rich text / attachments
- Per-note encryption settings separate from vault keys

## Status

Implemented across the Rust domain, WASM bridge, Simple Vault UI, imports, and
targeted tests.
