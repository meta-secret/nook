# TypeScript Named Call Arguments

## Purpose

In authored Nook Web TypeScript, object parameter contracts and object call
arguments must both be named and typed.

## Scope

Applies to all authored production TypeScript and Svelte under
`nook-app/nook-web`.

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

The Nook Web `nook-typed-api/no-raw-object-arguments` linter enforces this
contract. It:

- rejects inline object parameter types;
- requires an explicit type on named object-literal arguments;
- rejects generic or operation-only parameter names such as `Args`,
  `WriteArgs`, `PickArgs`, and `PutArgs`;
- recursively inspects wrapped and qualified type references;
- rejects inline array and tuple annotations in shorthand and generic form;
- requires named semantic contracts for maps, sets, and records;
- rejects imported generic names as bypasses;
- rejects object-valued parameter defaults, including literals, arrays,
  constructed class values, named bindings, and object-returning factory calls;
- inspects enclosing TypeScript syntax and call-site assignment, conditional,
  logical, or sequence expressions; and
- inspects statically resolvable object values from spread arrays.

Apply defaults at the call site or inside the function body after reading the
named contract.

The rule is configured in `nook-app/nook-web/eslint.config.js`.

Format the changed files and return one coherent commit to Gizmo. Gizmo
continues from that commit, runs pre-push hygiene, and pushes the exact head.
Gizmo then dispatches the applicable hosted pull-request validation.

Do not run `task web:lint` locally. There is no focused remote selector for
this rule. Do not invent a selector or substitute local validation.

## Application Checklist

- [ ] Search the changed package for inline object call arguments.
- [ ] Search function and method declarations for inline object parameter types.
- [ ] Prefer exported arg types from the callee module.
- [ ] Prefer Rust-generated types for domain-owned boundary contracts.
- [ ] Keep the applicable hosted Web validation green.
