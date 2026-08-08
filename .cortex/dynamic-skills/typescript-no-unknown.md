# TypeScript No Unknown

## Purpose

Do not author the `unknown` type in linted TypeScript or Svelte code.

Untrusted input uses a named external-value model instead.

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

`unknown` is an unnamed top type. It hides what external data is allowed to be
and pushes ad hoc narrowing everywhere.

## Preferred Pattern

```ts
export type ExternalValue =
  | string
  | number
  | boolean
  | readonly ExternalValue[]
  | ExternalObject;

export type ExternalObject = {
  readonly [key: string]: ExternalValue;
};

export function decodeDependencyPopularityRequest(value: ExternalValue)
```

Rules:

1. Do not write the `unknown` type token in enforced sources.
2. YAML/JSON and other untrusted payloads use `ExternalValue` /
   `ExternalObject`.
3. Narrow with `isRecord`, `isExternalNull`, `externalProperty`, and codec
   helpers — not `value as unknown` ladders.
4. Catch bindings stay unannotated or use concrete error types (`LoomFailure`,
   `Error`), never `catch (error: unknown)`.
5. Command results that are still loosely shaped use `ExternalValue` (or a
   domain result union), not `Promise<unknown>`.
6. Host parses (`JSON.parse`, `Bun.YAML.parse`, `response.json`) enter Loom
   through `asExternalValue(... as ExternalValue)` at the boundary only.

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

- [ ] Replace `unknown` parameters and fields with an external-value model or a
      domain type.
- [ ] Replace `Record<string, unknown>` with `ExternalObject`.
- [ ] Keep the applicable Loom or web lint task green.
