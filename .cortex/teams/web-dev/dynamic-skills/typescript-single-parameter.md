# TypeScript Single Parameter

## Purpose

Authored TypeScript functions and methods may take at most one parameter.
Multi-argument APIs must use a named object type.

## Scope

- Apply to:
  - `agentic-ai/loom` authored TypeScript;
  - all authored production TypeScript and Svelte under `nook-app/nook-web`.
- Exclude generated bindings.
- Host callback signatures may require multiple positional values.
  - Keep that boundary narrow.
  - Use a focused ESLint suppression with a reason when the host owns the
    callback shape.
  - Do not suppress a Nook-authored API.

## Problem Pattern

```ts
export function writeAgentStatsFile(
  request: AgentStatsFileRequest,
  sourcePath: string,
): Promise<AgentStatsFileResult>;
```

Multiple positional parameters hide argument meaning at call sites and make
reordering unsafe.

## Preferred Pattern

```ts
export type WriteAgentStatsFileArgs = {
  readonly request: AgentStatsFileRequest;
  readonly sourcePath: string;
};

export function writeAgentStatsFile(
  args: WriteAgentStatsFileArgs,
): Promise<AgentStatsFileResult>;
```

Call sites pass a single object:

```ts
const args: WriteAgentStatsFileArgs = { request, sourcePath };
writeAgentStatsFile(args);
```

Rules:

- Maximum one parameter per authored function, method, constructor, or arrow
  function.
- Every object-shaped parameter uses a named semantic `type`, `interface`, or
  Rust-generated boundary type.
  - Object-shaped includes object literals, mapped types such as `Pick<T, K>`
    and `Omit<T, K>`, arrays, tuples, maps, sets, and records.
- Inline object parameter annotations are prohibited, including for local
  helpers, destructured parameters, `T[]`, tuples, `Array<T>`, and
  `ReadonlyArray<T>`.
- Generic or operation-only contract names such as `Args`, `CallbackArgs`,
  `PutArgs`, or names derived from line numbers are prohibited.
  - Name the contract after its domain value or request.
- Do not use optional `undefined` parameters to fake multi-argument APIs.
  - Model omitted fields with domain unions or required object fields.
- Default values belong at the call site or inside the function body after
  reading the object, not as a second positional parameter.
- A function-valued parameter may return an inline object type.
  - That return value is not the parameter contract.
  - Object-shaped callback parameters still require named semantic contracts.

## Enforcement

ESLint `max-params: [error, 1]` enforces the rule in:

- `agentic-ai/loom/eslint.config.js`;
- `nook-app/nook-web/eslint.config.js`.

### Delivery

1. Format the changed files and return one coherent commit to Gizmo.
2. Gizmo pushes the exact head.
3. Gizmo dispatches the applicable hosted validation against that head.
   - For Loom-owned changes, this includes
     `task remote TASK_NAME=loom:verify`.

## Review checklist

- [ ] New authored functions take zero or one parameter.
- [ ] Multi-value inputs use a typed object argument.
- [ ] Every object-shaped parameter refers to a named semantic contract.
- [ ] Any host-callback exception is local and explains the host contract.
- [ ] The applicable hosted Loom or Nook Web validation stays green.
