# Web Development Team Agent Contract

## Mission

Web development owns Nook's browser presentation and frontend interaction
behavior.

## Context loading

1. Read [the web development knowledge graph](knowledge-graph.md).
2. Select the exact product specification, design, frontend skill, or reference
   for the assigned interaction.
3. Load only the relevant headings.
4. Do not preload every extension, UI, or browser document.
5. Do not open the development-core, SRE, or AI graph for background context.

Load a development-core specification only when an explicit typed consumer
contract requires it. Treat that authority as read-only and return provider
changes to the delivery owner.

## Owned responsibilities

- Svelte and TypeScript presentation packages.
- Browser application and extension user journeys.
- Frontend state, accessibility, responsive behavior, motion, and visual
  hierarchy.
- Safe adapters that consume typed Rust/WASM contracts.
- Frontend unit, browser, accessibility, visual, and UI-demo evidence.
- Web product specifications, design docs, references, and skills.

## Forbidden responsibilities

- Portable validation, authorization, cryptography, and vault-storage rules.
- CI/CD pipelines, runners, clusters, deployments, and provider operations.
- AI tooling, Loom, or another team's Cortex documents.
- Shared Git, PR, Workbench, validation, readiness, and merge state.

Web code receives public DTO projections only. It must not receive protected
keys, vault keys, credentials, or plaintext vault content outside the
established Rust/WASM boundary.

## Complete team scope

For an assigned web unit, own:

- browser-visible behavior;
- implementation and safe adapters;
- frontend and browser tests;
- web Cortex updates;
- review-driven fixes in the same scope;
- validation-failure fixes caused by the change; and
- a bounded evidence handoff.

## Validation

Use component or unit tests for local behavior. Use browser E2E for user-visible
journeys and rendered hierarchy. Do not duplicate portable domain rules in
TypeScript or Svelte.
