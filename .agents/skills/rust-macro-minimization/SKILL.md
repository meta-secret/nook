---
name: rust-macro-minimization
description: >-
  Eliminate repository-defined Rust macros and prevent new declarative or
  procedural macros. Use when authored Rust contains macro_rules definitions,
  exported convenience macros, generated routine types or implementations, or
  macro-based control flow that explicit Rust can express directly.
---

# Rust Macro Minimization

Read and follow the canonical project rule at
[`rust-macro-minimization.md`](../../../.cortex/dev-core/dynamic-skills/rust-macro-minimization.md).

Inventory every definition and caller, distinguish external integration macros
from repository-defined abstraction, then replace authored macros with explicit
structs, implementations, functions, and control flow. Preserve public and wire
contracts, run the macro-definition preflight, format, and validate the exact PR
head through GitHub Actions.
