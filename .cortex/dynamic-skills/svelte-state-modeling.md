# Svelte State Modeling

## Purpose

Keep Svelte rune state explicit by representing meaningful application states
as discriminated unions instead of implicit `undefined`.

## Problem Pattern

Authored web code can use an absent initial value as an unnamed lifecycle
state:

```ts
let selected = $state<Item>()
```

The declaration silently means `Item | undefined`, so every consumer must
remember what absence means and which other flags or fields are valid with it.

## Preferred Pattern

Use a discriminated union with named variants:

```ts
type SelectionState =
  | { kind: "not-selected" }
  | { kind: "selected"; item: Item }

let selection = $state<SelectionState>({ kind: "not-selected" })
```

Put data only on the variant that owns it. Group fields that transition
together into one union so illegal combinations cannot compile. Closed portable
domain workflows belong in Rust/WASM; component-local visual and browser
lifecycle states may use TypeScript discriminated unions.

Optionality does not justify erasing the value's domain type. Put generated
semantic identifiers such as `StoreId` and `PasswordEntryId` inside the
explicit variant, never widen them to `string`, when Rust owns that identifier.

Do not encode closed domain workflows as string-literal rune state. Use
generated Rust/WASM enums for authentication, unlock, recovery, Sentinel,
provider, and session phases. Keep string unions only for visual component
state such as panel, tab, accordion, or form-view selection.

Do not use zero-argument `$state<T>()` for modeled state. DOM element bindings
are structural browser references and may remain optional when Svelte owns
their assignment contract.

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
- Component-local visual state and browser-lifecycle state.

Does not apply to:

- Generated TypeScript declarations.
- Optional Rust/WASM DTO fields or domain workflows that should be modeled as
  Rust enums.
- DOM references, external inputs, generated/browser contracts, lookup/parser
  results, caches, and optional callbacks where absence is structural.

## Examples

- Before: `let result = $state<NookImportResult>()`
- After: `let result = $state<ImportState>({ kind: "idle" })`
- Before: `let selectedFile = $state<File>()`
- After: `let selection = $state<FileSelection>({ kind: "empty" })`
- Before: `selectedVaultStoreId = $state<string>()`
- After: `selection = $state<ValueState<StoreId>>({ kind: "empty" })`

## Application Checklist

- [ ] Search authored web sources for zero-argument `$state<T>()`,
      `$state<T | undefined>`, and assignments that clear state to `undefined`.
- [ ] Name each meaningful state and move state-owned data onto its variant.
- [ ] Combine fields that transition together instead of creating parallel
      optionals and booleans.
- [ ] Preserve Rust/WASM-owned identifier types instead of widening them to
      `string`.
- [ ] Replace domain string-literal unions with generated Rust/WASM enums;
      retain only visual string unions in Svelte.
- [ ] Preserve structural DOM and external-boundary absence only where the
      contract genuinely requires it.
- [ ] Remove redundant `?? undefined` while preserving `null` normalization at
      external boundaries.
- [ ] Escalate closed domain-state modeling to Rust/WASM rather than hiding it
      behind optional TypeScript fields.

## Validation

Run the syntax-aware TypeScript application-state preflight and
`git diff --check`. Run formatting only when preparing a push; product checks
remain in GitHub Actions.
