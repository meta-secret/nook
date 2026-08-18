# Rust WASM Name Coherence

## Purpose

Keep Rust WASM callables directly searchable across Rust, generated bindings,
and TypeScript.

## Problem Pattern

`#[wasm_bindgen(js_name = ...)]` gives an exported Rust function or method a
second JavaScript name. A reader cannot search one symbol and follow the call
across the language boundary. Renaming also makes generated bindings disagree
with the authored Rust API.

## Preferred Pattern

- Export functions and methods with their authored Rust names.
- Let generated JavaScript use `snake_case` for those callables.
- Import, re-export, and call generated functions with that same `snake_case`
  name. Do not use `as` to restore a TypeScript-style alias.
- Prefer direct cross-language coherence over TypeScript naming conventions.
- Keep `js_name` only for property getters or setters and imported browser APIs.
- Update generated-binding consumers atomically with a callable rename.

## Scope

Applies to:

- Authored Rust functions and methods exported through `wasm_bindgen`.
- TypeScript, JavaScript, and Svelte consumers of those generated exports.

Does not apply to:

- Exported getter or setter property names.
- Imported browser or third-party JavaScript APIs.
- Struct, enum, or TypeScript custom-section names.

## Examples

- Before: `#[wasm_bindgen(js_name = classifyExtensionPersistenceDatabases)]`
- After: `#[wasm_bindgen] pub fn classify_extension_persistence_databases(...)`
- TypeScript after: `classify_extension_persistence_databases(...)`

## Application procedure

1. Inventory callable `js_name` attributes in the requested scope.
2. Distinguish exported callables from properties and imports.
3. Remove callable renames and update every generated-binding consumer.
4. Remove aliases from generated-WASM imports and re-exports.
5. Check direct bindings and imports through local facade modules.
6. Confirm behavior is unchanged and typed Rust/WASM boundaries remain intact.
7. Require the syntax-aware preflight inventory to be empty.

## Validation

- Run the preflight core-ownership tests.
- Run WASM build and Node tests for generated binding coherence.
- Run web checks and tests for all consumers.
- Trigger complete exact-head PR validation.
