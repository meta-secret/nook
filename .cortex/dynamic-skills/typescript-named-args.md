# TypeScript Named Call Arguments

## Purpose

In authored TypeScript, do not pass raw object literals into function calls.
Build a named, typed argument value first.

## Scope

Applies to:

- `agentic-ai/loom` authored TypeScript;
- migrated `nook-app/nook-web` paths selected by the shared ESLint config.

Nook web expands enforcement one green package slice at a time.

Generated bindings are excluded.

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

Loom's ESLint `loom/no-raw-object-arguments` rule rejects call arguments that
are object literals, including statically resolvable spread-array elements and
literals selected by assignment, conditional, logical, or sequence results.
Its walk stops at function boundaries, so object literals returned by
function-valued arguments remain valid.

Nook web's `nook-typed-api/no-raw-object-arguments` rule enforces the same
contract. It also requires an explicit type on named object-literal arguments.

Both rules reject object literals behind TypeScript wrappers and call-site
assignment, conditional, logical, or sequence expressions. Loom also rejects
statically resolvable object values expanded from spread arrays.

The rule is configured in:

- `agentic-ai/loom/eslint.config.js` defines
  `loom/no-raw-object-arguments`;
- `nook-app/nook-web/eslint.config.js` uses
  `nook-typed-api/no-raw-object-arguments`.

```bash
task loom:verify
```

## Application Checklist

- [ ] Search the changed package for inline object call arguments.
- [ ] Prefer exported arg types from the callee module.
- [ ] Keep the applicable Loom or web lint task green.
