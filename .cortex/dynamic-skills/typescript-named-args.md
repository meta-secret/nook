# TypeScript Named Call Arguments

## Purpose

In authored TypeScript, object parameter contracts and object call arguments
must both be named and typed.

## Scope

Applies to:

- `agentic-ai/loom` authored TypeScript;
- raw object call arguments in all authored production TypeScript and Svelte
  under `nook-app/nook-web`;
- named parameter-contract declarations in the completed extension, research,
  and shared vault foundation source slices.

Remaining shared vault orchestration, component, main application, test, and
end-to-end declarations are migration debt, not precedent. New or changed
object parameters must already follow this contract during review.

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

Inline object parameter annotations create the same problem at the declaration:

```ts
function collectOutcomeObservation(args: { startedAt: number }): void
```

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

1. Every object-shaped function or method parameter uses a named semantic
   `type`, `interface`, or Rust-generated boundary type. Object-shaped includes
   object literals, mapped types such as `Pick<T, K>` and `Omit<T, K>`, arrays,
   tuples, maps, sets, and records.
2. Inline object parameter annotations are prohibited, including destructured
   parameters, local helpers, `T[]`, tuples, `Array<T>`, and
   `ReadonlyArray<T>`.
3. Generic or operation-only names such as `Args`, `CallbackArgs`, `PutArgs`,
   and line-number-derived names are prohibited. The name must identify the
   domain value or request.
4. Every call argument that is an object must be a named variable or constant.
5. That name should carry an explicit type (`ExpectFieldArgs<...>`,
   `ObjectJsonSchemaArgs`, `FieldErrorArgs`, etc.).
6. Object literals remain allowed when constructing that named value, and when
   returning a value from a function/`build` callback.
7. Do not bypass the rule with `fn({ ... } as SomeType)` — name the value
   first, then cast if a host boundary truly requires it.
8. Direct object arguments to Svelte's `$state`, `$state.raw`, `$derived`, and
   `$bindable` compiler runes are the narrow exception. Moving those values can
   violate rune placement or freeze reactive capture. This exception does not
   apply to `$state.snapshot` or ordinary calls.
9. A function-valued parameter may return an inline object type. That return
   value is not the parameter contract. Object-shaped parameters declared
   inside the callback still require named semantic contracts.

## Enforcement

Loom's ESLint `loom/no-raw-object-arguments` rule rejects call arguments that
are object literals, including statically resolvable spread-array elements and
literals selected by assignment, conditional, logical, or sequence results.
Its walk stops at function boundaries, so object literals returned by
function-valued arguments remain valid.

Nook web's `nook-typed-api/no-raw-object-arguments` rule enforces the same
contract. It rejects inline object parameter types and requires an explicit
type on named object-literal arguments. Both implementations also reject
direct parameter references whose names are generic or operation-only, such as
`Args`, `WriteArgs`, `PickArgs`, and `PutArgs`. Parameter contract names must
identify the domain value or request. They recursively inspect wrapped and
qualified type references. They reject inline array and tuple annotations in
both shorthand and generic form. Built-in maps, sets, and records also require
named semantic contracts. Imported generic names do not bypass enforcement.
They reject object-valued parameter defaults, including literals, arrays,
constructed class values, named bindings, and factory calls whose return
contract is object-shaped. Apply defaults at the call site or inside the
function body after reading the named contract.

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
- [ ] Search function and method declarations for inline object parameter types.
- [ ] Prefer exported arg types from the callee module.
- [ ] Prefer Rust-generated types for domain-owned boundary contracts.
- [ ] Keep the applicable Loom or web lint task green.
