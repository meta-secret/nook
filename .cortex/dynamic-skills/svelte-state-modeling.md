# Svelte State Modeling

## Purpose

Keep Svelte rune state declarations concise while preserving meaningful
uninitialized states.

## Problem Pattern

Authored web code repeats `undefined` in both the generic and initializer:

```ts
let selected = $state<Item | undefined>(undefined)
```

The two occurrences describe different layers—the accepted TypeScript value and
the initial runtime value—but Svelte's no-argument overload already expresses
both. Repeating them adds noise throughout state-owning modules.

## Preferred Pattern

Use the no-argument `$state<T>()` overload for state that starts absent:

```ts
let selected = $state<Item>()
```

Its inferred type is `Item | undefined`. Keep `undefined` when absence is a real
UI or lifecycle state, such as no selection, no completed sync, or an object
that has not loaded. Do not replace meaningful domain workflow variants with
optional UI state; model closed domain states in Rust/WASM.

Optionality does not justify erasing the value's domain type. Use generated
semantic identifiers such as `$state<StoreId>()` and
`$state<PasswordEntryId>()`, never `$state<string>()`, when Rust owns that
identifier.

Do not encode closed domain workflows as string-literal rune state. Use
generated Rust/WASM enums for authentication, unlock, recovery, Sentinel,
provider, and session phases. Keep string unions only for visual component
state such as panel, tab, accordion, or form-view selection.

Do not include `undefined` in a union when the state is initialized and never
cleared. For non-rune class fields that genuinely start absent, declare the
union without the redundant initializer:

```ts
syncTimer: ReturnType<typeof setInterval> | undefined
```

Do not write `value ?? undefined` when `value` is already typed as possibly
`undefined`. Keep `?? undefined` only at a boundary that converts a possible
`null` from a browser or generated API into Nook's `undefined` convention.

Use an explicit initializer when the state has a concrete initial value:

```ts
let items = $state<Item[]>([])
let isLoading = $state(false)
```

## Scope

Applies to:

- Authored `.svelte` and `.svelte.ts` files under `nook-app/nook-web`.
- Optional component-local and browser-lifecycle state.

Does not apply to:

- Generated TypeScript declarations.
- Optional Rust/WASM DTO fields or domain workflows that should be modeled as
  Rust enums.
- Function parameters and object properties where omission and an explicit
  `undefined` may have different API semantics.

## Examples

- Before: `$state<SvelteDate | undefined>(undefined)`
- After: `$state<SvelteDate>()`
- Before: `$state<string | undefined>(undefined)`
- After: `$state<string>()`
- Before: `selectedVaultStoreId = $state<string>()`
- After: `selectedVaultStoreId = $state<StoreId>()`

## Application Checklist

- [ ] Search authored web sources for `$state<T | undefined>(undefined)`.
- [ ] Replace it with `$state<T>()`.
- [ ] Confirm each absent value is a meaningful UI or lifecycle state.
- [ ] Preserve Rust/WASM-owned identifier types instead of widening them to
      `string`.
- [ ] Replace domain string-literal unions with generated Rust/WASM enums;
      retain only visual string unions in Svelte.
- [ ] Remove `undefined` union members from state that is never cleared.
- [ ] Remove redundant `?? undefined` while preserving `null` normalization at
      external boundaries.
- [ ] Escalate closed domain-state modeling to Rust/WASM rather than hiding it
      behind optional TypeScript fields.

## Validation

Search the authored web tree for the redundant declaration pattern and run
`git diff --check`. Run formatting only when preparing a push; product checks
remain in GitHub Actions.
