# Rust Macro Minimization

## Purpose

Keep authored Rust explicit and locally readable. Repository-defined macros are
prohibited because ordinary Rust with modest boilerplate is easier to inspect,
navigate, test, and change safely.

## Problem Pattern

`macro_rules!` or procedural macros generate routine structs, trait
implementations, conversions, errors, or control flow. The apparent reduction
in lines moves behavior behind token matching, makes diagnostics indirect, and
couples otherwise independent types to one hidden template.

## Preferred Pattern

Write the concrete structs, enums, implementations, functions, and branches at
their use site. Keep each type independently searchable and changeable. Prefer
small repeated implementations over a local metaprogramming language.

## Scope

Applies to:

- All authored Rust in product crates, tooling, tests, examples, and build
  scripts.
- Declarative macro definitions, exported macros, and procedural-macro
  entrypoints.
- Review of external macro use when it replaces code that plain Rust expresses
  more clearly.

Does not apply to:

- Generated source and third-party dependencies.
- Compiler- and ecosystem-provided derives and attributes required by an
  integration boundary, including Serde, thiserror, wasm-bindgen, Tsify, and
  test attributes.
- Standard formatting, logging, assertion, and collection-construction macros.
- Purpose-built external code-generation libraries where token generation is
  the actual product requirement rather than a shortcut for ordinary code.

## Examples

- Before: `agentic-ai/minds/hive/src/model.rs` generated four identifier types
  through `string_id!`.
- After: each identifier is an explicit struct with its own constructor,
  accessor, serialization contract, and display implementation.
- Before: Hive error macros hid `return Err(...)` and conditional branches.
- After: call sites construct `HiveError` and return it through ordinary Rust
  control flow.

## Application procedure

1. Inventory definitions and all call sites before editing.
2. Classify compiler and ecosystem integration separately from
   repository-defined abstraction.
3. Expand each redundant macro into explicit items or control flow.
4. Preserve serialized representations, error text, and public APIs.
5. Add or update syntax-aware preflight coverage.
6. Confirm no authored macro definition remains without a documented
   architecture exception.

## Validation

Development-core workers run the syntax-aware preflight tests.
They also run the smallest focused Rust tests that prove the changed behavior.
For implementation work, run `task format` on every allowed Rust or
development-core Cortex file changed by the worker. Inspect the resulting diff.
Return the coherent formatted commit without pushing or mutating external
delivery state. Gizmo runs `task loom:pre-push` on that head. If its
formatter changes development-core-owned content, Gizmo returns that diff to
development core for a fresh formatted commit instead of committing the
formatter output. Once that head passes cleanly,
Gizmo pushes it and immediately obtains remote evidence for that exact head.
Use at least one relevant focused remote task while the head is not ready for
complete validation. Otherwise, start complete exact-head validation
immediately. Gizmo uses `task pr:validate` for complete validation. Gizmo also
owns readiness and merge.
