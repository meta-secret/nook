# TypeScript Explicit State

## Purpose

Make TypeScript and Svelte application state describe meaningful variants
directly, so callers do not reconstruct a hidden state machine from
`undefined`, optional fields, booleans, and defensive condition chains.

## Problem Pattern

`T | undefined` is TypeScript's structural optional-value union, analogous to
Rust's `Option<T>`. It is precise for a lookup or external input, but it is too
weak when absence means a named product or lifecycle state:

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
- Keep `undefined` only when absence is the truthful structural contract:
  external/optional input, browser or generated API, lookup/parser result,
  cache, optional callback, or DOM reference.
- Normalize `null` from external APIs to `undefined` at the narrow boundary,
  then convert it to a named state before storing it.
- Do not create sentinel strings, fake default objects, non-null assertions,
  casts, or decorative one-variant wrappers to satisfy the check.

## Scope

Applies to:

- Mutable application state in authored `nook-app/nook-web` TypeScript and
  Svelte source.
- Svelte rune state, controller/class fields, module lifecycle resources,
  timers, in-flight operations, selections, results, and workflow data.

Does not apply to:

- Generated declarations and ambient external contracts.
- Function parameters and return values that truthfully model optional input,
  lookup, parsing, cache probing, or browser API behavior.
- Optional callbacks and Svelte/DOM references controlled by framework APIs.
- Test fixtures and build configuration unless they themselves model product
  state.

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

- [ ] Inventory every candidate before editing and classify structural absence
      separately from named application state.
- [ ] Replace modeled `undefined`, optional state fields, zero-argument runes,
      and coupled booleans with discriminated unions.
- [ ] Move portable policy and domain variants to Rust/WASM.
- [ ] Keep boundary conversion narrow and documented by the surrounding type.
- [ ] Add transition-focused tests and syntax-aware preflight fixtures.
- [ ] Search the changed scope again for implicit application-state absence.

## Validation

The AST-backed preflight rejects mutable application state that contains an
`undefined` type/value or a zero-argument state rune, while permitting explicit
boundary/query contracts. Add positive and negative fixtures whenever the rule
is sharpened. Run `task format` before pushing and use GitHub Actions as the
product validation gate.
