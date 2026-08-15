# Secure Notes

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
  - Adds secure notes as typed vault items.
  - Read first to understand the scope and intent of Overview.
- [Goals](#goals)
  - Stores encrypted free-form text under a user-visible title.
  - Read first to understand the scope and intent of Goals.
- [Implemented scope](#implemented-scope)
  - Defines ownership for the implemented secure-note surface.
  - Read before changing the implemented secure-note surface.
- [Editing behavior](#editing-behavior)
  - Uses the Rust/WASM replacement operation to update an existing secure note atomically.
  - Read before changing secure-note editing or replacement behavior.
- [Out of scope (for now)](#out-of-scope-for-now)
  - Defines the deferred secure-note capabilities.
  - Read before expanding the product boundary beyond Out of scope (for now).
- [Status](#status)
  - Records the implemented secure-note status.
  - Read when assessing the current state of Status.

## Overview

Add **secure notes** as a first-class vault item type alongside login, API key, and seed phrase.

## Goals

- Store free-form text such as recovery instructions, PINs, and license keys
  under a user-visible title.
- Reuse the existing typed-secret pipeline: `SecretType` variant, YAML payload, age-encrypted value, site grouping in the vault UI.
- Match add-item and detail-row patterns from other item types (reveal toggle, copy, delete).

## Implemented scope

| Area | Notes |
|---|---|
| Core (`secret_types.rs`) | `SecretType::SecureNote`, `SecureNoteSecret { title, note }` |
| Wasm bridge | Serialize/deserialize + validation in Rust |
| Web UI | Type picker, create/edit form, list and detail rendering, reveal, copy, and delete |
| Tests | Rust validation and replacement coverage plus browser create/reveal/delete coverage |

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
