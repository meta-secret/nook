# Rust WASM Name Coherence

## Purpose

Keep Rust WASM callables directly searchable across Rust, generated bindings,
and TypeScript.

## Problem Pattern

A callable `js_name` or case-renaming annotation gives one contract multiple
names. A reader cannot search one symbol and follow it across the language
boundary. A plain JavaScript reconstruction also hides the authored Rust type.

## Preferred Pattern

- Export functions and methods with their authored Rust names.
- Let generated JavaScript use `snake_case` for those callables.
- Import, re-export, and call generated functions with that same `snake_case`
  name. Do not use `as` to restore a TypeScript-style alias.
- Preserve authored Rust struct fields and enum variants in generated contracts.
- Do not add `rename_all` merely to convert Rust names into JavaScript casing.
- Do not add a second TypeScript interface over a generated Rust contract.
- Construct exported `#[wasm_bindgen]` objects through their generated classes.
- Do not reconstruct a typed input as a plain object or raw primitive.
- Prefer direct cross-language coherence over TypeScript naming conventions.
- Keep `js_name` only for property getters or setters and imported browser APIs.
- Keep an external protocol's fixed field names at its narrow wire adapter.
- Update generated-binding consumers atomically with a callable rename.

## Scope

Applies to:

- Authored Rust functions and methods exported through `wasm_bindgen`.
- Rust-owned fields, enum variants, structs, and generated TypeScript names.
- TypeScript, JavaScript, and Svelte consumers of those generated exports.

Does not apply to:

- Exported getter or setter property names.
- Imported browser or third-party JavaScript APIs.
- Fixed names owned by an external protocol.

## Examples

- Before: `#[wasm_bindgen(js_name = classifyExtensionPersistenceDatabases)]`
- After: `#[wasm_bindgen] pub fn classify_extension_persistence_databases(...)`
- TypeScript after: `classify_extension_persistence_databases(...)`

## Application procedure

1. Inventory callable `js_name` attributes in the requested scope.
2. Distinguish exported callables from properties and imports.
3. Remove callable renames and update every generated-binding consumer.
4. Inventory `rename_all` and field-level renames on Rust-owned contracts.
5. Remove aliases from generated-WASM imports and re-exports.
6. Remove plain-object or raw-value reconstructions of generated classes.
7. Check direct bindings and imports through local facade modules.
8. Confirm behavior is unchanged and typed Rust/WASM boundaries remain intact.
9. Require the syntax-aware preflight inventory to be empty.

## Validation

- Run the preflight core-ownership tests.
- Run WASM build and Node tests for generated binding coherence.
- Assert generated declarations retain the authored Rust names.
- Construct actual generated WASM classes in boundary tests.
- Run web checks and tests for all consumers.
- Trigger complete exact-head PR validation.
