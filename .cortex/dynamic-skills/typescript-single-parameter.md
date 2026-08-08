# TypeScript Single Parameter (Loom)

## Purpose

In Loom TypeScript, a function or method may take at most one parameter.
Multi-argument APIs must use a named object type.

## Scope

Applies only to `agentic-ai/loom` authored TypeScript (`src/` and `tests/`).

Does not apply to:

- `nook-app/nook-web` or other TypeScript packages
- Generated bindings
- Host callbacks that Loom does not author (third-party APIs Loom calls)

## Problem Pattern

```ts
export function decodeAgentStatsFilePayload(
  value: unknown,
  path: string,
): DecodeOutcome<AgentStatsFileRequest>
```

Multiple positional parameters hide argument meaning at call sites and make
reordering unsafe.

## Preferred Pattern

```ts
export type DecodeAgentStatsFilePayloadArgs = {
  readonly value: unknown;
  readonly path: string;
};

export function decodeAgentStatsFilePayload(
  args: DecodeAgentStatsFilePayloadArgs,
): DecodeOutcome<AgentStatsFileRequest>
```

Call sites pass a single object:

```ts
decodeAgentStatsFilePayload({ value, path })
```

Rules:

1. Maximum one parameter per function, method, constructor, or arrow function
   Loom authors.
2. When more than one value is needed, wrap them in a named exported type when
   the shape is reused, or an inline object type for local helpers.
3. Do not use optional `undefined` parameters to fake multi-arg APIs. Model
   omitted fields with domain unions or required object fields.
4. Default values belong at the call site or inside the function body after
   reading the object, not as a second positional parameter.

## Enforcement

ESLint `max-params: [error, 1]` in `agentic-ai/loom`.

```bash
task loom:verify
# or
bun run --cwd agentic-ai/loom lint
```

## Application Checklist

- [ ] New Loom functions take zero or one parameter.
- [ ] Multi-value inputs use a typed object argument.
- [ ] `bun run lint` / `task loom:verify` stays green.
