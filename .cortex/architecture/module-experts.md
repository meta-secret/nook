# Module Expert Registry

## Overview

This registry routes feature work to reusable, read-only domain experts.

The registry does not grant write authority.
It does not schedule work.
It does not replace package responsibilities in
[packages.md](packages.md).

Loom owns scheduling and attempt journals.
The delivery owner owns implementation, integration, and lifecycle state.

## Registry contract

Each profile names:

- production module roots;
- extra read-only evidence paths;
- explicit exclusions;
- public entry points;
- authority anchors;
- project skills;
- focused validation selectors;
- expected semantic evidence.

The executable catalog lives in
`agentic-ai/loom/src/module-experts/catalog.ts`.
Project role files live under `.codex/agents/module-experts/`.

Every role must report:

- the external API relevant to the task;
- dependencies and consumers;
- security and compatibility invariants;
- owning tests and focused validation;
- risks and unresolved decisions;
- actions required from the parent.

Every role is read-only.
Role files contain thin routing instructions instead of copied domain facts.

## Portable Rust module experts

### `app_common_expert`

- **Module root:** `nook-app/nook-platform/nook-app-common`.
- **Dependencies:** No Nook crate dependency.
- **Consumers:** `auth2_expert` and `core_expert`.
- **Entry point:** `src/lib.rs`.
- **Skills:** `module-expert`.
- **Validation:** `rust:test` and `rust:lint`.
- **Negative space:** Authentication, vault, browser, and presentation policy.

### `authenticator_domain_expert`

- **Module root:** `nook-app/nook-platform/nook-authenticator-domain`.
- **Dependencies:** No Nook crate dependency.
- **Consumers:** `auth2_expert`, `companion_core_expert`, and `core_expert`.
- **Entry point:** `src/lib.rs`.
- **Skills:** `module-expert`.
- **Validation:** `rust:test` and `rust:lint`.
- **Negative space:** Browser ceremonies, persistence, and presentation.

### `auth2_expert`

- **Module root:** `nook-app/nook-platform/nook-auth2`.
- **Dependencies:** `app_common_expert` and `authenticator_domain_expert`.
- **Consumers:** `event_log_expert`, `core_expert`, and fuzz targets.
- **Entry point:** `src/lib.rs`.
- **Skills:** `module-expert`.
- **Validation:** `rust:test` and `rust:lint`.
- **Negative space:** Provider I/O, browser ceremonies, and vault UI.

### `replication_expert`

- **Module root:** `nook-app/nook-platform/nook-replication`.
- **Dependencies:** No Nook crate dependency.
- **Consumers:** `event_log_expert`.
- **Entry point:** `src/lib.rs`.
- **Skills:** `module-expert`.
- **Validation:** `rust:test` and `rust:lint`.
- **Negative space:** Identity, vault, provider, and presentation policy.

### `event_log_expert`

- **Module root:** `nook-app/nook-platform/nook-event-log`.
- **Dependencies:** `auth2_expert` and `replication_expert`.
- **Consumers:** `companion_core_expert` and `core_expert`.
- **Entry point:** `src/lib.rs`.
- **Skills:** `module-expert`.
- **Validation:** `rust:test` and `rust:lint`.
- **Negative space:** Plaintext secrets, provider I/O, and browser APIs.

### `companion_core_expert`

- **Module root:** `nook-app/nook-platform/nook-companion-core`.
- **Dependencies:** `authenticator_domain_expert` and `event_log_expert`.
- **Consumers:** `core_expert` and `internal_api_expert`.
- **Entry point:** `src/lib.rs`.
- **Skills:** `module-expert`.
- **Validation:** `rust:test` and `rust:lint`.
- **Negative space:** Browser runtime APIs and WASM binding adaptation.

### `core_expert`

- **Module root:** `nook-app/nook-platform/nook-core`.
- **Dependencies:** The portable Rust experts required by its live manifest.
- **Consumers:** `internal_api_expert`.
- **Entry point:** `src/lib.rs`.
- **Skills:** `module-expert`.
- **Validation:** `rust:test` and `rust:lint`.
- **Negative space:** Browser I/O, generated bindings, and presentation.

## Internal API expert

`internal_api_expert` owns inter-module contract analysis.
It replaces a narrow WASM-boundary role.
No separate WASM or bridge expert is allowed.

- **Module roots:** `nook-wasm` and `nook-companion-wasm`.
- **Extra scope:** Both generated binding directories in `nook-web-shared`.
- **Consumers:** All Rust or TypeScript modules that cross these boundaries.
- **Entry points:** Both bridge crates' `src/lib.rs` files.
- **Skills:** `module-expert` and `internal-api-expert`.
- **Validation:** `rust:lint`, `web:check`, and `web:test`.
- **Negative space:** Product invention, presentation design, and module-internal
  implementation choices that do not affect consumers.

The expert produces the smallest consumer-visible contract.
It identifies:

- the requesting consumer;
- the owning provider;
- dependency direction;
- typed inputs, outputs, and errors;
- data, security, and compatibility boundaries;
- provider contract tests;
- dependent continuation order;
- unresolved decisions for the delivery owner.

## Production web expert

`web_expert` covers the initial production presentation group.

- **Module roots:** `nook-vault-simple`, `nook-vault-sentinel`, `nook-web-app`,
  `nook-web-extension`, and `nook-web-shared`.
- **Dependencies:** Published Rust/WASM contracts and shared web components.
- **Consumers:** Browser users, extension contexts, and hosted test harnesses.
- **Entry points:** Each production package's `package.json`.
- **Skills:** `module-expert` plus task-specific frontend or extension skills.
- **Validation:** `web:check`, `web:test`, and `extension:check`.
- **Negative space:** `nook-web-research` and generated-binding adaptation.

Split this grouped profile only when stable public interfaces and disjoint
resource claims make independent ownership useful.

## Excluded surfaces

- `nook-web-research` is disposable and non-production.
- Vendored third-party code receives no Nook module expert.
- Experimental agent infrastructure is not part of local feature development.
- Hive does not schedule or represent local module-development work.
- Shared lockfiles, root registries, Workbench, Git, and PR state remain with
  the delivery owner.

## Validation

Run the deterministic registry audit:

```bash
task loom:module-experts:validate
```

The audit rejects:

- malformed or write-capable role definitions;
- missing or duplicate production-module routes;
- missing authority, skill, scope, or entry-point paths;
- production routing for `nook-web-research`;
- an uncataloged role in the module-expert directory;
- a separate WASM or bridge role;
- incomplete `internal_api_expert` scope.
