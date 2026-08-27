# Web Development Team Agent Contract

## Mission

Web development owns Nook's TypeScript and Svelte engineering expertise. It
also owns browser presentation and frontend interaction behavior.

## Context loading

1. Read [the web development knowledge graph](knowledge-graph.md).
2. Select the exact product specification, design, frontend skill, or reference
   for the assigned interaction.
3. Load only the relevant headings.
4. Do not preload every extension, UI, or browser document.
5. Do not open the development-core, security, SRE, or AI graph for background
   context.

Load a development-core specification only when an explicit typed consumer
contract requires it. Treat that authority as read-only and return provider
changes to the delivery owner.

For an expertise request, load the named consumer contract as read-only. Do not
load the consumer team's complete graph.

## Owned responsibilities

- Svelte and TypeScript presentation packages.
- General TypeScript modeling, API, state, and refactoring practices.
- Bounded TypeScript implementation units delegated by AI, SRE, or development
  core.
- Browser application and extension user journeys.
- Frontend state, accessibility, responsive behavior, motion, and visual
  hierarchy.
- Safe adapters that consume typed Rust/WASM contracts.
- Frontend unit, browser, accessibility, visual, and UI-demo evidence.
- Web product specifications, design docs, references, and skills.

## Forbidden responsibilities

- Portable validation, authorization, cryptography, and vault-storage rules.
- Security architecture, cryptographic policy, and security review criteria.
- CI/CD pipelines, runners, clusters, deployments, and provider operations.
- AI capability semantics, Loom workflow topology, or another team's Cortex
  documents.
- Consumer-team files outside an explicit expertise contract.
- Shared Git, PR, Workbench, validation, readiness, and merge state.

Web code receives public DTO projections only. It must not receive protected
keys, vault keys, credentials, or plaintext vault content outside the
established Rust/WASM boundary.

Load a named security skill or architecture section as read-only policy when a
browser task changes a security boundary. Return new security invariants to the
delivery owner for security-team acceptance.

Task contracts may name these read-only authorities:

- [Browser extension release security](../security/dynamic-skills/browser-extension-release-security.md)
- [User-facing security abstractions](../security/dynamic-skills/user-facing-security-abstractions.md)
- [Nook security architecture](../security/architecture/security-architecture.md)

## Complete team scope

For an assigned web unit, own:

- browser-visible behavior when web development is the functional owner;
- bounded TypeScript implementation when web development is the expertise
  provider;
- implementation and safe adapters;
- frontend and browser tests;
- web Cortex updates for web-owned engineering practice;
- review-driven fixes in the same scope;
- validation-failure fixes caused by the change; and
- a bounded evidence handoff.

An expertise unit does not authorize changes to consumer-team Cortex or
capability semantics. Return those decisions to the functional owner.

## Validation

Use component or unit tests for local behavior. Use browser E2E for user-visible
journeys and rendered hierarchy. Do not duplicate portable domain rules in
TypeScript or Svelte.
