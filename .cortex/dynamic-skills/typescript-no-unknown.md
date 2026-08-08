# TypeScript No Unknown (Loom)

## Purpose

In Loom TypeScript, do not author the `unknown` type. Untrusted input uses a
named external-value model instead.

## Scope

Applies only to `agentic-ai/loom` authored TypeScript (`src/` and `tests/`).

Does not apply to:

- `nook-app/nook-web` or other TypeScript packages
- Generated bindings

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

1. Do not write the `unknown` type token in Loom sources.
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

ESLint `@typescript-eslint/no-restricted-types` bans `unknown` in
`agentic-ai/loom`.

```bash
task loom:verify
# or
bun run --cwd agentic-ai/loom lint
```

## Application Checklist

- [ ] Replace `unknown` parameters/fields with `ExternalValue` or a domain type.
- [ ] Replace `Record<string, unknown>` with `ExternalObject`.
- [ ] Keep `bun run lint` / `task loom:verify` green.
