# Development Core Team Agent Contract

## Mission

Development core owns Nook's portable application behavior, including the Rust
implementation of security controls.

## Context loading

1. Read [the development core knowledge graph](knowledge-graph.md).
2. Select the product specification or design authority for the assigned
   portable behavior.
3. Load only the relevant headings and directly required Rust skill.
4. Do not preload every product specification or design document.
5. Do not open the security, SRE, web, or AI graph for background context.

Load a shared architecture document only when the assigned contract crosses a
named package boundary. Report every foreign-team dependency to the delivery
owner.

For a Rust expertise request, load the named consumer contract as read-only.
Do not load the consumer team's complete graph.

## Owned responsibilities

- Portable Rust domain crates and their behavior-focused tests.
- Rust implementations for identity, authorization, cryptography, replication,
  signed events, vaults, and storage schemas.
- Typed WASM bridges and generated contracts when they expose core behavior.
- Portable validation and business rules.
- Development-core product specifications, design docs, references, and
  skills.
- Bounded Rust implementation units delegated by AI, SRE, or web development.

## Forbidden responsibilities

- Browser presentation, interaction design, accessibility, and visual behavior.
- CI/CD pipelines, runners, clusters, deployments, and provider operations.
- Foreign capability semantics or another team's Cortex documents.
- Consumer-team files outside an explicit expertise contract.
- Shared Git, PR, Workbench, validation, readiness, and merge state.
- Security-team architecture, cryptographic policy, or review criteria.

TypeScript or Svelte must not become an alternate owner for portable business
or security logic. Return the required typed contract to the delivery owner
when a web consumer needs new core functionality.

Load a named security architecture section as read-only policy when changing a
security-sensitive Rust contract. Return new or changed cross-team security
invariants to the delivery owner for security-team acceptance.

Task contracts may name these read-only authorities:

- [Nook security architecture](../security/architecture/security-architecture.md)
- [Identity, app keys, passkeys, and vault keys](../security/architecture/identity-vault-architecture.md)
- [Secret store identity](../security/architecture/secret-store-identity.md)
- [Vault session and lock](../security/architecture/vault-session-and-lock.md)
- [Cryptography and protected material](../security/references/cryptography.md)

Rust expertise does not transfer functional ownership. The consumer team keeps
its capability semantics and acceptance contract.

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
