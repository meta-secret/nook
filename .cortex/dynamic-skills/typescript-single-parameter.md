# TypeScript Single Parameter

## Purpose

Authored TypeScript functions and methods may take at most one parameter.
Multi-argument APIs must use a named object type.

## Scope

Applies to:

- `agentic-ai/loom` authored TypeScript;
- all authored production TypeScript and Svelte under `nook-app/nook-web`.

Generated bindings are excluded.

Host callback signatures may require multiple positional values.

Keep that boundary narrow.

Use a focused ESLint suppression with a reason when the host owns the callback
shape.

Do not suppress a Nook-authored API.

## Problem Pattern

```ts
export function writeAgentStatsFile(
  request: AgentStatsFileRequest,
  sourcePath: string,
): Promise<AgentStatsFileResult>
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
): Promise<AgentStatsFileResult>
```

Call sites pass a single object:

```ts
const args: WriteAgentStatsFileArgs = { request, sourcePath }
writeAgentStatsFile(args)
```

Rules:

1. Maximum one parameter per authored function, method, constructor, or arrow
   function.
2. Every object-shaped parameter uses a named semantic `type`, `interface`, or
   Rust-generated boundary type. Object-shaped includes object literals,
   mapped types such as `Pick<T, K>` and `Omit<T, K>`, arrays, tuples, maps,
   sets, and records.
3. Inline object parameter annotations are prohibited, including for local
   helpers, destructured parameters, `T[]`, tuples, `Array<T>`, and
   `ReadonlyArray<T>`.
4. Generic or operation-only contract names such as `Args`, `CallbackArgs`,
   `PutArgs`, or names derived from line numbers are prohibited. Name the
   contract after its domain value or request.
5. Do not use optional `undefined` parameters to fake multi-arg APIs. Model
   omitted fields with domain unions or required object fields.
6. Default values belong at the call site or inside the function body after
   reading the object, not as a second positional parameter.
7. A function-valued parameter may return an inline object type. That return
   value is not the parameter contract. Object-shaped callback parameters still
   require named semantic contracts.

## Enforcement

ESLint `max-params: [error, 1]` enforces the rule in:

- `agentic-ai/loom/eslint.config.js`;
- `nook-app/nook-web/eslint.config.js`.

```bash
task loom:verify
# or
bun run --cwd agentic-ai/loom lint
```

## Application Checklist

- [ ] New authored functions take zero or one parameter.
- [ ] Multi-value inputs use a typed object argument.
- [ ] Every object-shaped parameter refers to a named semantic contract.
- [ ] Any host-callback exception is local and explains the host contract.
- [ ] The applicable Loom or web lint task stays green.
