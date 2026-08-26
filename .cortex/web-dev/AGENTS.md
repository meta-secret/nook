# Web Development Team Agent Contract

## Mission

Web development owns Nook's browser presentation and frontend interaction behavior.

Read [the web development knowledge graph](knowledge-graph.md) before inspecting team files.
Follow the common [engineering team ownership](../architecture/team-ownership.md) authority.

## Owned responsibilities

- Svelte and TypeScript presentation packages.
- Browser application and extension user journeys.
- Frontend state, accessibility, responsive behavior, motion, and visual hierarchy.
- Safe adapters that consume typed Rust/WASM contracts.
- Frontend unit, browser, accessibility, visual, and UI-demo evidence.
- Web-development product specifications, design docs, references, and skills.

## Forbidden responsibilities

- Portable validation, authorization, cryptography, and vault-storage rules.
- CI/CD pipelines, runners, clusters, deployments, and provider operations.
- Development-core or SRE Cortex documents.
- Shared Git, PR, Workbench, validation, readiness, and merge state.

Web code receives public DTO projections only.
It must not receive protected keys, vault DEKs, credentials, or plaintext vault content outside the established Rust/WASM boundary.

## Complete team scope

For an assigned web-development unit, own:

- the browser-visible behavior;
- implementation and safe adapters;
- frontend and browser tests;
- web-development Cortex updates;
- review-driven fixes in the same scope;
- validation-failure fixes caused by the change; and
- a bounded evidence handoff.

Report core or SRE dependencies to the delivery owner.
Do not implement them inside web paths.

## Validation

Use focused component or unit tests for local behavior.
Use browser E2E for user-visible journeys and rendered hierarchy.
Do not duplicate portable domain rules in TypeScript or Svelte.
