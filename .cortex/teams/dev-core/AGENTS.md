# Development Core Team Agent Contract

## Mission

Development core owns Nook's portable application and security domain.

## Context loading

1. Read [the development core knowledge graph](knowledge-graph.md).
2. Select the product specification or design authority for the assigned
   portable behavior.
3. Load only the relevant headings and directly required Rust skill.
4. Do not preload every product specification or design document.
5. Do not open the SRE, web, or AI graph for background context.

Load a shared architecture document only when the assigned contract crosses a
named package boundary. Report every foreign-team dependency to the delivery
owner.

## Owned responsibilities

- Portable Rust domain crates and their behavior-focused tests.
- Identity, authorization, cryptography, replication, signed events, vaults,
  and storage schemas.
- Typed WASM bridges and generated contracts when they expose core behavior.
- Portable validation and business rules.
- Development-core product specifications, design docs, references, and
  skills.

## Forbidden responsibilities

- Browser presentation, interaction design, accessibility, and visual behavior.
- CI/CD pipelines, runners, clusters, deployments, and provider operations.
- AI tooling, Loom, or another team's Cortex documents.
- Shared Git, PR, Workbench, validation, readiness, and merge state.

TypeScript or Svelte must not become an alternate owner for portable business
or security logic. Return the required typed contract to the delivery owner
when a web consumer needs new core functionality.

## Complete team scope

For an assigned development-core unit, own:

- the provider contract;
- implementation;
- Rust and WASM tests;
- development-core Cortex updates;
- review-driven fixes in the same scope;
- validation-failure fixes caused by the change; and
- a bounded evidence handoff.

## Validation

Prove portable behavior at the Rust layer. Add typed bridge tests when the WASM
contract changes. Browser E2E does not replace domain tests.
