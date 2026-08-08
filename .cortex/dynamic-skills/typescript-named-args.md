# TypeScript Named Call Arguments (Loom)

## Purpose

In Loom TypeScript, do not pass raw object literals into function calls.
Build a named, typed argument value first.

## Scope

Applies only to `agentic-ai/loom` authored TypeScript (`src/` and `tests/`).

## Problem Pattern

```ts
expectBoolean({
  record: object.value,
  key: CortexAuditField.IncludeDensityLint,
  path: ROOT,
})
```

Inline object literals hide the argument type at the call site and make reuse /
review harder.

## Preferred Pattern

```ts
const includeDensityLintArgs: ExpectFieldArgs<CortexAuditField> = {
  record: object.value,
  key: CortexAuditField.IncludeDensityLint,
  path: ROOT,
};
const includeDensityLint = expectBoolean(includeDensityLintArgs);
```

Rules:

1. Every call argument that is an object must be a named variable or constant.
2. That name should carry an explicit type (`ExpectFieldArgs<...>`,
   `ObjectJsonSchemaArgs`, `FieldErrorArgs`, etc.).
3. Object literals remain allowed when constructing that named value, and when
   returning a value from a function/`build` callback.
4. Do not bypass the rule with `fn({ ... } as SomeType)` — name the value
   first, then cast if a host boundary truly requires it.

## Enforcement

ESLint `no-restricted-syntax` in `agentic-ai/loom` rejects call arguments that
are object literals (including `as`-cast object literals).

```bash
task loom:verify
```

## Application Checklist

- [ ] Search for `foo({` call sites in Loom and extract named typed args.
- [ ] Prefer exported arg types from the callee module.
- [ ] Keep `bun run lint` / `task loom:verify` green.
