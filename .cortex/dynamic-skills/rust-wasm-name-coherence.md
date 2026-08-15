# Rust WASM Name Coherence

## Relationships

- [Cortex document navigation](cortex-document-map.md)
  - Defines the mandatory relationship and internal-map structure.
  - Apply whenever this skill card changes.
- [Cortex writer](cortex-writer.md)
  - Keeps the card and its navigation summaries concise.
  - Apply while editing or reviewing this guidance.
- [Cortex consistency](cortex-consistency.md)
  - Requires the card to agree with related guidance and current code.
  - Apply when rules, paths, commands, or examples change.

## Document map

- [Purpose](#purpose)
  - Explains why the skill exists and what invariant it protects.
  - Read first to decide whether the skill applies.
- [Problem Pattern](#problem-pattern)
  - Identifies the recurring rejected pattern and its warning signs.
  - Read while locating or reviewing violations.
- [Preferred Pattern](#preferred-pattern)
  - Defines the required structure or behavior.
  - Read before implementing a correction.
- [Scope](#scope)
  - Sets the applicable paths and explicit boundaries.
  - Read before expanding the task.
- [Examples](#examples)
  - Contrasts rejected and preferred forms.
  - Read when the rule needs a concrete illustration.
- [Application Checklist](#application-checklist)
  - Lists the steps needed to apply and maintain the skill.
  - Use during implementation and review.
- [Validation](#validation)
  - Names the smallest relevant mechanical and semantic proof.
  - Run before completing the task.

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

## Application Checklist

- [ ] Inventory callable `js_name` attributes in the requested scope.
- [ ] Distinguish exported callables from properties and imports.
- [ ] Remove callable renames and update every generated-binding consumer.
- [ ] Remove aliases from generated-WASM imports and re-exports.
- [ ] Check direct bindings and imports through local facade modules.
- [ ] Keep behavior unchanged and preserve typed Rust/WASM boundaries.
- [ ] Require the syntax-aware preflight inventory to be empty.

## Validation

- Run the preflight core-ownership tests.
- Run WASM build and Node tests for generated binding coherence.
- Run web checks and tests for all consumers.
- Trigger complete exact-head PR validation.
