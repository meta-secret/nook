# Function Ownership

## Priority

This is the primary code-structure rule for every implementation language.
Every authored function belongs to a meaningful owner.

An owner represents the knowledge, capability, state, lifecycle, or external
contract required by the operation. A file, module, namespace, or generic
utility container is not an owner by itself.

## Required actions

- Put every authored public, private, and nested function on a meaningful
  domain, application, infrastructure, fixture, or framework owner.
- Use an instance method when the operation depends on owned state or
  capability.
- Use an associated or static method for construction and cohesive stateless
  behavior.
- Use a real trait, interface, or equivalent abstraction only when it expresses
  a shared contract.
- Keep closures local only when they express an immediately used operation.
- Put test behavior on a focused fixture, harness, builder, or scenario owner.
- Keep required language entrypoints and externally fixed callbacks thin.
  Delegate portable behavior to a meaningful owner.
- Name the owner for the domain knowledge or capability it holds.

## Prohibited actions

- Do not introduce an unowned free function.
- Do not treat a file, module, namespace, or directory name as function
  ownership.
- Do not hide functions in `Utils`, `Helpers`, `Common`, `Shared`, or another
  catch-all owner.
- Do not create an empty type, trait, interface, or object only to relocate free
  functions.
- Do not keep a nested helper function when its behavior belongs to an existing
  owner.
- Do not use a closure to bypass ownership for reusable behavior.
- Do not invent object identity, lifecycle phases, or a generic framework for a
  pure operation. Use a cohesive associated or static operation on its
  meaningful owner.

## Narrow boundaries

A compiler-required entrypoint, FFI export, generated ABI function, test-runner
entrypoint, or framework callback may retain its externally owned shape.

Document the exact external requirement when the boundary is not
self-evident. Keep the boundary function limited to decoding, delegation, and
encoding. A conventional name alone does not establish an exception.

Svelte component handlers and lifecycle callbacks belong to the component only
when they use that component's state or interaction contract. Shared behavior
moves to its meaningful domain or application owner.

## Language applications

- Rust follows
  [action ownership and typestate](../../teams/dev-core/design-docs/rust-action-ownership.md).
- TypeScript follows
  [domain structure](../../teams/web-dev/dynamic-skills/typescript-domain-structure.md).
- Repository automation follows the same rule in authored Rust and TypeScript.
- Taskfile declarations remain declarative tasks rather than authored
  functions.

## Validation

- Treat every new or changed unowned function as a P1 review finding.
- Inspect public, private, nested, test, callback, and adapter functions.
- Verify that the selected owner has semantic knowledge or capability required
  by the operation.
- Reject a mechanical move into a catch-all type or object.
- Use language-specific static enforcement where it exists.
- Keep review enforcement mandatory where static enforcement does not exist.
