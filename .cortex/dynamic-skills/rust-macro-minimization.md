# Rust Macro Minimization

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

## Application Checklist

- [ ] Inventory definitions and all call sites before editing.
- [ ] Classify compiler/ecosystem integration separately from
      repository-defined abstraction.
- [ ] Expand each redundant macro into explicit items or control flow.
- [ ] Preserve serialized representations, error text, and public APIs.
- [ ] Add or update syntax-aware preflight coverage.
- [ ] Confirm no authored macro definition remains without a documented
      architecture exception.

## Validation

Run the syntax-aware preflight tests and the focused hosted Rust tasks. For
implementation work, run `task format`, commit and push, then explicitly trigger
complete exact-head validation with `task pr:validate`.
