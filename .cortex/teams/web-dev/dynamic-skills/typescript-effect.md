# TypeScript Effect Workflows

## Purpose

Use Effect v3 to model effectful TypeScript workflows explicitly. Effect keeps
expected failures, service requirements, resource lifetimes, concurrency, and
runtime boundaries visible in one composable program.

This policy complements [TypeScript domain structure](typescript-domain-structure.md)
and [TypeScript explicit state](typescript-explicit-state.md). It does not move
portable product or security ownership out of Rust/WASM.

## Scope

This policy applies to authored TypeScript, JavaScript, and Svelte scripts,
including production code, tests, build scripts, and agent tooling.

Use Effect for a new or materially changed workflow when it is asynchronous,
models expected failure, owns a resource lifecycle, coordinates concurrency,
uses effectful services, or decodes untrusted boundary data.

Do not use Effect to wrap pure calculations, inert type declarations, or Svelte
rendering for ceremony. Keep pure calculations as ordinary pure functions.

## Required actions

- Compose effectful workflows with Effect v3.
  - In TypeScript, describe a workflow as `Effect.Effect<Success, Failure, Services>`.
  - Keep expected failure types tagged and put them in Effect's error channel.
  - Propagate or handle those failures at the owner that can classify or
    present them.
- Decode untrusted input with Effect Schema at the narrowest TypeScript
  boundary.
  - Validate data before application code treats it as a concrete value.
  - Keep parse failures in the workflow's typed error channel.
  - Use existing generated Rust/WASM contracts when Rust owns the data model.
- Use `Context` tags for effectful services and `Layer` values to construct
  and provide their implementations.
  - Apply them to dependencies such as browser ports, network clients, clocks,
    or storage adapters when the workflow needs an effectful dependency.
  - Keep purely local calculations as ordinary functions.
- Use `Scope` and `Effect.acquireRelease` for resources whose lifetime needs
  guaranteed cleanup.
  - Tie cleanup to the scope that owns the resource.
- Use Effect's concurrency and observability facilities when workflows need
  parallel execution, cancellation, coordination, logging, metrics, or tracing.
  - Keep those concerns inside the Effect workflow that owns them.
- Keep `Effect.run*` at explicit runtime, UI, browser, worker, or framework
  entry boundaries.
  - Keep application workflows as Effect values until they reach that edge.
  - Adapt the result to the host contract at the edge.
- Keep feedback loops tight when authoring Effect with an AI assistant.
  - Use Effect LSP tooling where available.
  - The official Effect v3 guide recommends this for Effect development.
- Migrate a materially changed workflow coherently to Effect.
  - Update the connected callers needed to keep that workflow on one failure
    model.
  - Keep external Promise APIs at integration edges and lift them into Effect
    before internal orchestration.

## Prohibited actions

- Do not add new `neverthrow` flows or hand-rolled Promise error workflows.
- Do not mix Effect and `neverthrow` or Promise-based error handling inside one
  materially changed workflow.
- Do not use exceptions or Promise rejection as the model for expected
  application failures.
- Do not call `Effect.run*` deep inside domain or application orchestration.
- Do not mirror Rust-owned domain types, product policy, or security rules in
  TypeScript or Effect Schema.
- Do not replace a typed Rust/WASM contract with a TypeScript-owned schema or
  validation rule.
- Do not wrap pure calculations, declarations, or rendering with Effect when
  they have no asynchronous, failure, resource, service, concurrency, or
  boundary-decoding concern.

## Existing migration debt

Existing untouched `neverthrow` workflows may remain temporarily as migration
debt. They must not spread to new code. When a workflow is materially changed,
migrate that workflow coherently to Effect instead of extending or mixing the
old abstraction.

This policy does not require a repository-wide migration in unrelated work.

## Effect v3 references

- [Getting started](https://effect.website/docs/v3/getting-started) introduces
  Effect and recommends a tight LLM feedback loop with Effect LSP tooling.
- [Two types of errors](https://effect.website/docs/v3/error-management/two-error-types)
  explains typed expected errors and the Effect error channel.
- [Managing services](https://effect.website/docs/v3/requirements-management/services)
  explains `Context` service tags and `Layer` dependency construction.
- [Schema introduction](https://effect.website/docs/v3/schema/introduction)
  explains decoding and validation with Effect Schema.
- [Scope](https://effect.website/docs/v3/resource-management/scope) explains
  scoped finalizers and `Effect.acquireRelease`.
- [Running effects](https://effect.website/docs/v3/getting-started/running-effects)
  recommends keeping `Effect.run*` near the program edge.
