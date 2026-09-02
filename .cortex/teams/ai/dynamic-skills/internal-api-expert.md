# Internal API Expert

## Purpose

Design and review the smallest consumer-visible contract across Nook module
boundaries.

This replaces a narrow WASM-boundary expert.

## Problem Pattern

A provider exposes implementation details before the consumer need is clear.
Client code then drives ad hoc Rust, WASM, generated-binding, or TypeScript
changes without one owned contract.

## Preferred Pattern

Treat every changed boundary as an explicit provider-consumer edge.

The contract brief states:

- consumer need;
- provider owner;
- dependency direction;
- typed inputs, outputs, and errors;
- data and security boundaries;
- compatibility expectations;
- provider contract tests;
- dependent continuation order;
- unresolved decisions.

Prefer the smallest API that satisfies the named consumer.
Keep domain validation in the owning Rust crate.
Keep generated bindings searchable and coherent with authored Rust names.

## Scope

Apply to changed contracts across:

- portable Rust crates;
- `nook-core` and `nook-wasm`;
- `nook-companion-core` and `nook-companion-wasm`;
- Rust/WASM and generated TypeScript bindings;
- shared web code and production applications.

Do not create a separate WASM or bridge expert.
`internal_api_expert` owns both WASM bridge surfaces.

## Examples

- Define a core result and error contract before exposing a WASM method.
- Review generated binding changes before web client code consumes them.
- Keep a module-internal refactor with its module expert when no consumer
  contract changes.

## Application procedure

1. Name the consumer and observable capability.
2. Resolve provider ownership in the module registry.
3. Inspect the provider's public entry point and existing consumers.
4. Write the bounded contract brief.
5. Ask the provider expert to verify ownership and tests.
6. Return the accepted edge to the delivery owner.

## Validation

- Return the coherent formatted implementation to Gizmo.
- Gizmo dispatches hosted provider module tests.
- Gizmo dispatches hosted generated Rust/WASM/TypeScript coherence evidence
  when bindings change.
- Continue to consumer code only after the provider contract is accepted.
- After routing changes, Gizmo pushes the exact head and runs
  `task remote TASK_NAME=loom:verify`.
