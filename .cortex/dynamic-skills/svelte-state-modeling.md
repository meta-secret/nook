# Svelte State Modeling

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
enum SelectionKind {
  NotSelected = "not-selected",
  Selected = "selected",
}

type SelectionState =
  | { kind: SelectionKind.NotSelected }
  | { kind: SelectionKind.Selected; item: Item }

let selection = $state<SelectionState>({ kind: SelectionKind.NotSelected })
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
provider, and session phases. Use meaningfully named TypeScript enums for
visual component state such as panel, tab, accordion, or form-view selection.

Do not use zero-argument `$state<T>()` for modeled state. DOM element bindings
also use a named `unmounted/mounted` state when authored code reads or mutates
the reference.

Convert browser or generated API absence directly into a semantic state; do
not normalize one forbidden absence sentinel into another.

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
- Generated external contracts. Authored adapters still convert their result
  into a named state immediately.

## Examples

- Before: `let result = $state<NookImportResult>()`
- After: `let result = $state<ImportState>({ kind: ImportKind.Idle })`
- Before: `let selectedFile = $state<File>()`
- After: `let selection = $state<FileSelection>({ kind: FileSelectionKind.Empty })`
- Before: `selectedVaultStoreId = $state<string>()`
- After: `vaultSelection = $state<VaultSelection>({ kind: VaultSelectionKind.NotSelected })`

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
- [ ] Convert DOM, lookup, parser, cache, and external-boundary absence into
      meaningfully named states at the narrowest authored boundary.
- [ ] Escalate closed domain-state modeling to Rust/WASM rather than hiding it
      behind optional TypeScript fields.

## Validation

Run the syntax-aware TypeScript application-state preflight and
`git diff --check`. Run formatting only when preparing a push; product checks
remain in GitHub Actions.
