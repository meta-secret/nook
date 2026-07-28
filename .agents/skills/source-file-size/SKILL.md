---
name: source-file-size
description: >-
  Enforce Nook's most critical source-structure rule: 1,000 lines for non-Rust
  and 1,500 for Rust. Use whenever a source file approaches or crosses a limit,
  the preflight scanner fails, or a large-file refactor is planned. Rust
  compliance requires production domain or architectural decomposition;
  separate unit-test files, test extraction, and arbitrary numbered splits are
  prohibited. Crate-level integration tests remain separate.
---

# Critical Source File Size

Read and follow the canonical project rule at
[`.cortex/dynamic-skills/source-file-size.md`](../../../.cortex/dynamic-skills/source-file-size.md).

## Required response to a violation

1. Inventory the production responsibilities and their change reasons.
2. Choose a domain, capability, ownership, lifecycle, or dependency seam.
3. Split production code into cohesive, meaningfully named modules.
4. Narrow dependencies instead of passing the original whole state or service.
5. Put each Rust unit-test module inline with its focused implementation;
   reserve crate-level `tests/` files for true integration tests.
6. Run the source-size preflight, then `task format`, push, and validate the
   exact head through GitHub Actions.

For Rust, moving unit tests into a separate source file is itself a failure.
Split the production abstractions and colocate their unit tests. Never cut files
by line count or create `part1`, `part2`, `continued`, or equivalent fragments.
