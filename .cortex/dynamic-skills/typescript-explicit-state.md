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
let timer: ReturnType<typeof setTimeout> | undefined;
let started = false;
```

This permits combinations such as `started === false` with a scheduled timer.
The code relies on every mutation site preserving an undocumented invariant.
Zero-argument `$state<T>()`, optional field bags, and several independently
mutable flags create the same problem.

## Preferred Pattern

- Use a discriminated union for named product, workflow, lifecycle, resource,
  and component states.
- Classify ownership before creating an enum. Authentication, vault, recovery,
  Sentinel, provider, sync, secret-schema, and other portable product
  vocabularies belong to `nook-core` and are exposed directly through
  `nook-wasm`; TypeScript must not mirror or rename them. Browser protocol,
  browser lifecycle, and presentation-only vocabularies use a cohesive,
  meaningfully named TypeScript enum. Union variants reference enum members
  (`kind: SessionKind.Closed`), never raw string literal types
  (`kind: "closed"`).
  Preserve the enum's serialized string values when browser messaging,
  persistence, or external compatibility requires them.
- Apply the same enum ownership to closed protocol fields such as `type`,
  `status`, `phase`, `stage`, `mode`, `action`, and `operation`. A wire format
  is a reason for string-valued enum members, not a reason to repeat raw string
  literals throughout authored code.
- Use enum members in constructors, comparisons, switch cases, and fixtures,
  not only in the union declaration. Any authored closed string-literal union
  has the same requirement even when its field is not named `kind` or `type`.
- Svelte script blocks support runtime TypeScript enums through the required
  Vite script preprocessor. Put runtime enums consumed by a component instance
  in a cohesive adjacent `.ts` state module and import them normally. Do not
  declare the enum in a same-file `<script module>`: Svelte can type-check that
  cross-script reference while omitting the runtime binding from the instance
  bundle.
- Declaring the enum in the instance `<script lang="ts">` fails the same way and
  is worse, because it type-checks and only breaks at runtime. The preprocessor
  transpiles the script in isolation, so esbuild inlines every in-script member
  read to its literal and then drops the now-unused enum object. Member reads in
  the template are not part of that transform, survive as `Enum.Member`, and
  throw `ReferenceError: Enum is not defined` on first render. `svelte-check`,
  `tsc`, and the Vite build all stay green, so only running the component
  catches it. The adjacent `.ts` module is the requirement, not a preference.
- Prefer one enum per cohesive state machine or protocol vocabulary. Do not
  create a repository-wide `StateKind`, `MessageType`, or other generic enum
  that merely centralizes unrelated strings.
- Put state-specific values on the variant that owns them.
- Group values that transition together; expose operations such as `start`,
  `cancel`, `succeed`, and `reset` instead of exposing mutable handles.
- Put portable domain state and policy in Rust and export typed enums through
  WASM. Consume the generated enum itself; a differently named TypeScript enum
  or type alias with the same values is still a forbidden domain mirror. Keep
  browser lifecycle and visual state in TypeScript/Svelte.
- Match variants exhaustively. Do not convert a discriminated union back into
  parallel booleans.
- Normalize optional external input shape into an explicit union immediately.
- Use `void` normally as TypeScript's unit/effect type. Function and callback
  return types, `Promise<void>`, `void | Promise<void>` for a
  synchronous-or-asynchronous effect, and unary `void expression` for
  intentionally discarded results are valid and equivalent to Rust `()`, not
  `Option<T>`.
- Do not use `void` as unnamed value absence. `Result | void`,
  `Promise<Result | void>`, parameters, callback results, and other nested
  value-or-void contracts all need a semantic state union. This is true even
  when no mutable slot stores the result: the caller still receives unnamed
  absence rather than unit effect completion.
- Normalize missing browser, lookup, parser, cache, and DOM results directly
  into a domain-specific union at the narrow boundary.
- Normalize external `null` directly into the same explicit union at the
  boundary; authored `null` is forbidden.
- Never introduce a generic TypeScript `Option` clone. Names such as
  `ValueState`, `EMPTY_VALUE`, `presentValue`, `valueState`, and
  `valueFromState` merely rename `undefined`; they do not explain why a value
  is absent or what transition makes it available.
- Name both the union and its variants for the lifecycle being modeled:
  `not-loaded/loaded`, `unmounted/mounted`, `idle/scheduled`,
  `not-selected/selected`, `locked/active`, or more precise domain language.
- Do not create sentinel strings, fake default objects, non-null assertions,
  casts, or decorative one-variant wrappers to satisfy the check.
- Never hide the sentinel behind a string comparison such as
  `typeof value === "undefined"`. Use a structural property/capability check
  for external shape, or normalize immediately into a semantic union.
- Tests must assert the semantic variant, required value, or structural
  property contract. `toBeUndefined`, `toBeNull`, `toBeDefined`, and equivalent
  absence matchers preserve the forbidden implicit contract without spelling
  the value token and are prohibited.

## Scope

Applies to every authored `.js`, `.mjs`, `.cjs`, `.ts`, and `.svelte` file,
including production source, tests, fixtures, demos, build configuration,
`.agents`, `.github`, and `agentic-ai`.

Generated declarations, dependency/build directories, and generated WASM
bindings are excluded because they mirror contracts Nook does not author.

## Examples

Before:

```ts
let timer: ReturnType<typeof setTimeout> | undefined;
let started = false;
```

After:

```ts
type TrackerState =
  | { kind: TrackerKind.Stopped }
  | { kind: TrackerKind.Tracking; timer: ReturnType<typeof setTimeout> };
```

Before:

```ts
let result = $state<NookImportResult>();
let loading = $state(false);
```

After:

```ts
type ImportState =
  | { kind: ImportKind.Idle }
  | { kind: ImportKind.Loading }
  | { kind: ImportKind.Complete; result: NookImportResult }
  | { kind: ImportKind.Failed; message: string };
```

## Application Checklist

- [ ] Inventory every authored token before editing and classify boundary
      absence separately from named application state.
- [ ] Replace modeled `undefined`, optional state fields, zero-argument runes,
      parameterless `$bindable()` props, value-or-void contracts, and coupled
      booleans with discriminated unions or truthful concrete input values.
- [ ] Reject generic optional-value wrappers and require semantic type and
      variant names at every application-state site.
- [ ] Replace every raw string-literal discriminant with a member of a
      cohesive, meaningfully named string enum.
- [ ] Move portable policy and domain variants to Rust/WASM.
- [ ] Keep boundary conversion narrow and documented by the surrounding type.
- [ ] Add transition-focused tests and syntax-aware preflight fixtures.
- [ ] Run the repository-wide AST preflight and require a zero-result inventory.

## Validation

The AST-backed preflight rejects every executable or type-level `undefined` and
`null` token, parameterless `$bindable()` defaults, every quoted-sentinel
comparison, every `T | void` value contract including nested generics and
returns, every generic optional-state escape hatch, and assertion matchers that
encode implicit absence in authored JavaScript, TypeScript, and Svelte. It
accepts complete `void` function and callback returns, `Promise<void>`,
`void | Promise<void>` effects, and unary discard expressions. The
Rust-boundary preflight also rejects
`#[tsify(type = "...")]` field overrides containing `undefined`, `null`, or
`void`, `Option<T>` fields on `Tsify` exports, and `Option<T>` parameters or
returns on `wasm_bindgen` exports. Rust-owned domain absence must be a named
Rust enum before code generation. It also rejects
raw string literal types on closed unions and discriminant fields (`kind`,
`type`, `status`, `phase`, `stage`, `mode`, `action`, and `operation`), plus raw
runtime discriminant constructors and comparisons, while accepting enum member
types and ignoring comments and unrelated prose strings. Add positive and
negative fixtures whenever the rule is sharpened. Run `task format` before
pushing and use GitHub Actions as the product validation gate.
