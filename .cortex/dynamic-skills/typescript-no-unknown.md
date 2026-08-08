# TypeScript No Unknown

## Purpose

Do not author the `unknown` type in linted TypeScript or Svelte code.

Do not replace it with another generic value in domain or application code.

Model concrete domain values.

## Scope

Applies to:

- `agentic-ai/loom` authored TypeScript;
- migrated `nook-app/nook-web` paths selected by the shared ESLint config.

Nook web expands enforcement one green package slice at a time.

Generated bindings are excluded.

## Problem Pattern

```ts
export function decodeDependencyPopularityRequest(value: unknown)
export type UnknownRecord = Record<string, unknown>
```

`unknown` is an unnamed top type.

`ExternalValue` is also generic.

Either type can erase domain meaning when it escapes a parser or transport
adapter.

## Preferred Pattern

```ts
export type DependencyPopularityRequest = {
  readonly packageName: string;
  readonly ecosystem: DependencyEcosystem;
};

export function evaluateDependencyPopularity(
  request: DependencyPopularityRequest,
): DependencyPopularityResult
```

Rules:

1. Do not write the `unknown` type token in enforced sources.
2. Do not use `ExternalValue`, `ExternalObject`, `JsonValue`, or equivalent
   recursive value bags as domain models.
3. Do not store generic values in application state.
4. Do not expose generic values through commands, services, or UI APIs.
5. Define concrete structs, enums, unions, and identifiers for domain data.
6. Catch bindings stay unannotated or use concrete error types (`LoomFailure`,
   `Error`), never `catch (error: unknown)`.
7. Command results use domain result unions. They must not use
   `Promise<unknown>` or `Promise<ExternalValue>`.

## Narrow Boundary Exception

A generic transport value is allowed only when a host API provides untyped
JSON, YAML, WASM, or browser IPC data.

The exception must stay inside a dedicated parser, codec, message guard, or
contiguous boundary-decoding pipeline.

The adapter must:

- validate the input immediately;
- return a concrete domain type or a typed decode failure from the completed
  boundary pipeline;
- pass a generic value only between adjacent steps in that boundary pipeline;
- avoid storing the generic value;
- avoid passing the generic value into domain or application services;
- keep casts at the host boundary.

Do not treat this exception as the preferred application type.

If a concrete platform input type exists, use it instead.

The generic type may appear only at that boundary:

```ts
export function decodeDependencyPopularityRequest(
  value: ExternalValue,
): DecodeOutcome<DependencyPopularityRequest>
```

## Enforcement

ESLint `@typescript-eslint/no-restricted-types` bans `unknown` in:

- `agentic-ai/loom/eslint.config.js`;
- `nook-app/nook-web/eslint.config.js`.

```bash
task loom:verify
# or
bun run --cwd agentic-ai/loom lint
```

## Application Checklist

- [ ] Replace `unknown` parameters and fields with concrete domain types.
- [ ] Remove generic recursive values from state, results, and service APIs.
- [ ] Keep any unavoidable external-value use inside a dedicated adapter.
- [ ] Prove that each adapter returns a concrete domain type or typed failure.
- [ ] Keep the applicable Loom or web lint task green.
