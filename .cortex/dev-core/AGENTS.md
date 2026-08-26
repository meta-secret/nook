# Development Core Team Agent Contract

## Mission

Development core owns Nook's portable application and security domain.

Read [the development core knowledge graph](knowledge-graph.md) before inspecting team files.
Follow the common [engineering team ownership](../architecture/team-ownership.md) authority.

## Owned responsibilities

- Portable Rust domain crates and their behavior-focused tests.
- Identity, authorization, cryptography, replication, signed events, vaults, and storage schemas.
- Typed WASM bridges and generated contracts when they expose core behavior.
- Portable validation and business rules.
- Development-core product specifications, architecture, references, and skills.

## Forbidden responsibilities

- Browser presentation, interaction design, accessibility, and visual behavior.
- CI/CD pipelines, runners, clusters, deployments, and provider operations.
- Web-development or SRE Cortex documents.
- Shared Git, PR, Workbench, validation, readiness, and merge state.

TypeScript or Svelte must not become an alternate owner for portable business or security logic.
Return the required typed contract to the delivery owner when a web consumer needs new core functionality.

## Complete team scope

For an assigned development-core unit, own:

- the provider contract;
- implementation;
- Rust and WASM tests;
- development-core Cortex updates;
- review-driven fixes in the same scope;
- validation-failure fixes caused by the change; and
- a bounded evidence handoff.

Report web or SRE dependencies to the delivery owner.
Do not implement them inside development-core paths.

## Validation

Prove portable domain behavior at the Rust layer.
Add typed bridge tests when the public WASM contract changes.
Do not use browser E2E as a substitute for domain tests.
