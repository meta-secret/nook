# TypeScript Named Call Arguments

## Purpose

In authored TypeScript, object parameter contracts and object call arguments
must both be named and typed.

## Scope

Applies to:

- `agentic-ai/loom` authored TypeScript;
- all authored production TypeScript and Svelte under `nook-app/nook-web`.

There is no production-source migration allowlist. Every function-valued prop,
local helper, callback, method, and exported function must use a named semantic
parameter contract when its parameter is object-shaped.

Generated bindings are excluded.

## Problem Pattern

```ts
expectBoolean({
  record: object.value,
  key: CortexAuditField.IncludeDensityLint,
  path: ROOT,
});
```

Inline object literals hide the argument type at the call site and make reuse /
review harder.

Inline object parameter annotations create the same problem at the declaration:

```ts
function collectOutcomeObservation({
  startedAt,
  authPath,
  sawMutation,
}: {
  startedAt: number;
  authPath: string;
  sawMutation: boolean;
}): void;
```

## Preferred Pattern

```ts
interface OutcomeObservationRequest {
  readonly startedAt: number;
  readonly authPath: string;
  readonly sawMutation: boolean;
}

function collectOutcomeObservation({
  startedAt,
  authPath,
  sawMutation,
}: OutcomeObservationRequest): void;

const includeDensityLintArgs: ExpectFieldArgs<CortexAuditField> = {
  record: object.value,
  key: CortexAuditField.IncludeDensityLint,
  path: ROOT,
};
const includeDensityLint = expectBoolean(includeDensityLintArgs);
```

Rules:

- Every object-shaped function or method parameter uses a named semantic
  `type`, `interface`, or Rust-generated boundary type.
  - Object-shaped includes object literals, mapped types such as `Pick<T, K>`
    and `Omit<T, K>`, arrays, tuples, maps, sets, and records.
- Inline object parameter annotations are prohibited, including destructured
  parameters, local helpers, `T[]`, tuples, `Array<T>`, and
  `ReadonlyArray<T>`.
- Generic or operation-only names such as `Args`, `CallbackArgs`, `PutArgs`,
  and line-number-derived names are prohibited.
  - The name must identify the domain value or request.
- Every call argument that is an object must be a named variable or constant.
  - The name should carry an explicit type such as `ExpectFieldArgs<...>`,
    `ObjectJsonSchemaArgs`, or `FieldErrorArgs`.
- Object literals remain allowed:
  - when constructing that named value; and
  - when returning a value from a function or `build` callback.
- Do not bypass the rule with `fn({ ... } as SomeType)`.
  - Name the value first, then cast if a host boundary truly requires it.
- Direct object arguments to Svelte's `$state`, `$state.raw`, `$derived`, and
  `$bindable` compiler runes are the narrow exception.
  - Moving those values can violate rune placement or freeze reactive capture.
  - This exception does not apply to `$state.snapshot` or ordinary calls.
- A function-valued parameter may return an inline object type.
  - That return value is not the parameter contract.
  - Object-shaped parameters declared inside the callback still require named
    semantic contracts.

## Enforcement

The two linters enforce one contract:

- **Loom:** `loom/no-raw-object-arguments` rejects object-literal call
  arguments.
  - It includes statically resolvable spread-array elements.
  - It includes literals selected by assignment, conditional, logical, or
    sequence results.
  - Its walk stops at function boundaries, so object literals returned by
    function-valued arguments remain valid.
- **Nook web:** `nook-typed-api/no-raw-object-arguments` enforces the same call
  contract.
- **Both implementations:**
  - reject inline object parameter types;
  - require an explicit type on named object-literal arguments;
  - reject generic or operation-only parameter names such as `Args`,
    `WriteArgs`, `PickArgs`, and `PutArgs`;
  - recursively inspect wrapped and qualified type references;
  - reject inline array and tuple annotations in shorthand and generic form;
  - require named semantic contracts for maps, sets, and records;
  - reject imported generic names as bypasses; and
  - reject object-valued parameter defaults, including literals, arrays,
    constructed class values, named bindings, and object-returning factory
    calls.
- **Defaults:** apply them at the call site or inside the function body after
  reading the named contract.
- **Wrapped expressions:** both rules inspect enclosing TypeScript syntax and
  call-site assignment, conditional, logical, or sequence expressions.
  - Loom also inspects statically resolvable object values from spread arrays.

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
- [ ] Search function and method declarations for inline object parameter types.
- [ ] Prefer exported arg types from the callee module.
- [ ] Prefer Rust-generated types for domain-owned boundary contracts.
- [ ] Keep the applicable Loom or web lint task green.
