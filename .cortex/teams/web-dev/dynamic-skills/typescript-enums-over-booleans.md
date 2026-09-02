# TypeScript Enums Instead of Booleans

## Purpose

Do not use `boolean` as an authored domain, application, workflow, lifecycle,
policy, mode, command, configuration, or owned-contract value. Use a cohesive,
meaningfully named enum even when the value currently has exactly two cases.

For state-specific payloads, use a discriminated union whose discriminant is a
member of that enum. Portable product and security vocabulary belongs in Rust
and crosses WASM as a generated enum; TypeScript must consume it rather than
declare a mirror.

## Why Booleans Fail

A boolean carries no domain metadata in its value. `true` does not say what is
enabled, which behavior it selects, or why the state exists.

- **Call sites lose meaning.** `runSync(true)` forces the reader to find the
  declaration before the argument can be understood.
- **Mental complexity increases.** Every reader must remember what `true` and
  `false` mean for each particular value.
- **Arguments are easy to confuse.** Positional booleans can be swapped without
  a type error. Putting flags into a named object avoids positional swapping but
  does not repair the weak state model.
- **Two cases do not stay two cases.** A third state requires a breaking type,
  schema, and caller rewrite instead of one new enum variant.
- **Multiple flags create invalid combinations.** Independent booleans can
  represent states the application must never enter.
- **Reviews lose intent.** A changed `true` or `false` literal does not explain
  the behavior being selected.

## Required Pattern

Enums put the domain meaning into both the type and every value.

- Name the real cases: `Scheduled` and `Forced`, `Hidden` and `Exposed`, or
  `Capture` and `Propagate`.
- Do not create decorative `True` / `False`, `Yes` / `No`, or `Enabled` /
  `Disabled` enums without naming what the states mean.
- Use distinct enum types for distinct decisions. The type checker must reject
  accidentally exchanging sync freshness with failure handling.
- Match enums and discriminated unions exhaustively so a new case identifies
  every decision point that must change.
- Put variant-specific data on the discriminated-union member that owns it.
- Do not persist or send a boolean that can be derived from a semantic enum.
- Use the enum member at constructors, call sites, comparisons, fixtures, and
  protocol boundaries. Do not erase it back to a boolean for convenience.

Before:

```ts
interface SyncRequest {
  readonly force: boolean;
  readonly failFast: boolean;
}

const request: SyncRequest = { force: true, failFast: false };
runSync(request);
```

After:

```ts
enum ProviderSyncFreshness {
  Scheduled = "scheduled",
  Forced = "forced",
}

enum ProviderSyncFailureHandling {
  Capture = "capture",
  Propagate = "propagate",
}

interface SyncRequest {
  readonly freshness: ProviderSyncFreshness;
  readonly failureHandling: ProviderSyncFailureHandling;
}

const request: SyncRequest = {
  freshness: ProviderSyncFreshness.Forced,
  failureHandling: ProviderSyncFailureHandling.Capture,
};
runSync(request);
```

For state with associated data:

```ts
enum ImportKind {
  Idle = "idle",
  Loading = "loading",
  Complete = "complete",
}

type ImportState =
  | { readonly kind: ImportKind.Idle }
  | { readonly kind: ImportKind.Loading }
  | { readonly kind: ImportKind.Complete; readonly result: NookImportResult };
```

## Narrow Exceptions

An authored `boolean` requires a concrete reason. Convenience, fewer lines,
test-only code, or having only two cases today are not reasons.

The allowed cases are intentionally narrow:

- A language, platform, dependency, or host callback contract requires a
  boolean, such as an immediately returned predicate. Keep that signature at
  the boundary.
- A fixed external protocol owns a boolean field that Nook cannot change.
  Normalize it into a named enum immediately before application policy reads
  it, and convert back only at the outbound boundary.
- A private predicate answers a literal yes-or-no query such as `isEmpty()` or
  `contains()`. Consume the result immediately in control flow. Do not store it
  as application state or pass it onward as policy, mode, or configuration.

Raw browser observations are not a general exception. Once an observation
enters application behavior, normalize it to an owned browser enum or pass it
to Rust/WASM for a portable domain decision.

Every retained public parameter, stored field, or lint suppression involving a
boolean must document which narrow exception applies. Fixtures, tests, scripts,
and internal DTOs do not receive a blanket exemption.

## Scope

Applies to every authored `.js`, `.mjs`, `.cjs`, `.ts`, and `.svelte` file,
including production source, tests, fixtures, demos, build configuration,
`.agents`, `.github`, and `agentic-ai`.

Generated declarations, dependency/build directories, and generated WASM
bindings are excluded because they mirror contracts Nook does not author.

## Application Checklist

- [ ] Inventory authored boolean fields, parameters, returns, state, and lint
      suppressions in the changed scope.
- [ ] Replace every domain, application, workflow, lifecycle, policy, mode,
      command, configuration, persistence, and owned-contract boolean with a
      meaningfully named enum.
- [ ] Replace coupled flags with one discriminated union that represents only
      legal states.
- [ ] Consume generated Rust/WASM enums directly for portable vocabulary.
- [ ] Keep a boolean only for a required boundary or an immediately consumed
      private predicate, and document the exact exception when it is retained
      in a public parameter or stored field.
- [ ] Add exhaustive state and transition tests for every new enum variant.

## Validation

Run `task format`, commit the coherent handoff, and return it to Gizmo. Gizmo
dispatches the relevant hosted validation for TypeScript state, the affected
package typecheck, and behavior tests. Treat existing boolean-focused lint
suppressions as migration findings, not as justification for another boolean.
