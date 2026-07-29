# TypeScript Explicit State

## Purpose

Make every authored JavaScript, TypeScript, and Svelte absence explicit, so
callers do not reconstruct a hidden state machine from `undefined`, optional
fields, booleans, and defensive condition chains.

## Problem Pattern

`T | undefined` is TypeScript's implicit optional-value union, analogous to an
unnamed Rust `Option<T>`. In authored code it loses the semantic distinction
between a missing lookup, an idle workflow, a released resource, and a
contract violation:

```ts
let timer: ReturnType<typeof setTimeout> | undefined
let started = false
```

This permits combinations such as `started === false` with a scheduled timer.
The code relies on every mutation site preserving an undocumented invariant.
Zero-argument `$state<T>()`, optional field bags, and several independently
mutable flags create the same problem.

## Preferred Pattern

- Use a discriminated union for named product, workflow, lifecycle, resource,
  and component states.
- Put state-specific values on the variant that owns them.
- Group values that transition together; expose operations such as `start`,
  `cancel`, `succeed`, and `reset` instead of exposing mutable handles.
- Put portable domain state and policy in Rust and export typed enums through
  WASM. Keep browser lifecycle and visual state in TypeScript/Svelte.
- Match variants exhaustively. Do not convert a discriminated union back into
  parallel booleans.
- Use optional property/parameter syntax only to mirror external input shape,
  and normalize the value into an explicit union immediately.
- Use `void` for callbacks and commands that intentionally return no value.
- Normalize missing browser, lookup, parser, cache, and DOM results directly
  into a `none`/`some` or domain-specific union at the narrow boundary.
- Normalize `null` from external APIs directly into the same explicit union.
- Do not create sentinel strings, fake default objects, non-null assertions,
  casts, or decorative one-variant wrappers to satisfy the check.

## Scope

Applies to every authored `.js`, `.mjs`, `.cjs`, `.ts`, and `.svelte` file,
including production source, tests, fixtures, demos, build configuration,
`.agents`, `.github`, and `agentic-ai`.

Generated declarations, dependency/build directories, and generated WASM
bindings are excluded because they mirror contracts Nook does not author.

## Examples

Before:

```ts
let timer: ReturnType<typeof setTimeout> | undefined
let started = false
```

After:

```ts
type TrackerState =
  | { kind: "stopped" }
  | { kind: "tracking"; timer: ReturnType<typeof setTimeout> }
```

Before:

```ts
let result = $state<NookImportResult>()
let loading = $state(false)
```

After:

```ts
type ImportState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "complete"; result: NookImportResult }
  | { kind: "failed"; message: string }
```

## Application Checklist

- [ ] Inventory every authored token before editing and classify boundary
      absence separately from named application state.
- [ ] Replace modeled `undefined`, optional state fields, zero-argument runes,
      and coupled booleans with discriminated unions.
- [ ] Move portable policy and domain variants to Rust/WASM.
- [ ] Keep boundary conversion narrow and documented by the surrounding type.
- [ ] Add transition-focused tests and syntax-aware preflight fixtures.
- [ ] Run the repository-wide AST preflight and require a zero-result inventory.

## Validation

The AST-backed preflight rejects every executable or type-level `undefined`
token in authored JavaScript, TypeScript, and Svelte while ignoring comments
and string literals. Add positive and negative fixtures whenever the rule is
sharpened. Run `task format` before pushing and use GitHub Actions as the
product validation gate.
