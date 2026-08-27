# Module Expert Registry

## Overview

This registry routes feature work to reusable, read-only domain experts.

The registry does not grant write authority.
It does not schedule work.
It does not replace package responsibilities in
[packages.md](../../../shared/architecture/packages.md).

The active Codex, Cursor, or other capable harness owns expert scheduling and
communication.
The delivery owner owns integration and lifecycle state.

## Engineering team routing

Every module expert runs inside one engineering-team ownership domain.

- Portable Rust, companion-domain, core, and Rust/WASM bridge evidence routes
  through the development-core team graph.
- Production web evidence routes through the web-development team graph.
- Infrastructure and CI are excluded from this production module registry and
  route through the SRE team graph.
- The internal API expert may inspect an accepted provider-consumer boundary
  across teams. It remains read-only and cannot transfer ownership.

The delivery owner selects the team before invoking a module expert.
The expert must not expand into another team's implementation scope.

## Registry contract

Each profile names:

- production module roots;
- cross-module boundary scope when the role owns boundary analysis;
- extra read-only evidence paths;
- generated output scopes with their producers, materializers, and required
  markers;
- explicit exclusions;
- public entry points;
- authority anchors;
- project skills;
- canonical skill and workflow context required by those project skills;
- focused validation selectors;
- expected semantic evidence.

The executable catalog lives in
`agentic-ai/loom/src/module-experts/catalog.ts`.
Project role files live under `.codex/agents/module-experts/`.

Every successful native-harness role completion returns equivalent semantic
evidence fields. Optional compiled Loom runs use the dedicated
`ModuleExpertEvidence` result kind. The continuation contains these non-empty
evidence lists:

- `externalApi`;
- `dependencies`;
- `consumers`;
- `behaviorInvariants`;
- `securityInvariants`;
- `compatibilityInvariants`;
- `owningTests`;
- `focusedValidation`;
- `risks`;
- `unresolvedDecisions`;
- `parentActions`.

An explicit none-with-reason entry represents an empty category.
The lists are bounded, unique, and free of control characters.
`parentActions` is evidence for the delivery owner.
It does not grant scheduling or mutation authority.

Every invocation uses a declared task contract.
The contract binds:

- task and expert identity;
- exact source commit;
- parent lineage and hierarchy depth bound;
- evidence or write scope;
- dependencies and resource claims;
- acceptance evidence;
- parent-owned join.

The active harness owns native expert creation, communication, scheduling,
retries, cancellation, barriers, nested delegation, and synthesis. Native
semantic evidence, optional `ModuleExpertEvidence`, and `parentActions` remain
recommendations.
They do not authorize descendants, writes, integration, or lifecycle changes.

Role definitions preserve two structural rules:

- Every role is read-only.
- Role files contain thin routing instructions instead of copied domain facts.

The role TOML is an identity and behavioral default.
It routes the harness to the relevant domain context.
It does not grant filesystem capability or delivery ownership.

Read-only experts receive a bounded evidence surface from the exact source
commit.
Write-capable module tasks are separate implementation assignments.
They require:

- an isolated disposable worktree or workspace;
- an explicit allowed-path scope;
- a fresh workspace for every retry;
- a commit whose ancestry begins at the declared baseline;
- verification that the commit changed only allowed paths;
- task-specific tests and acceptance evidence;
- deterministic parent-owned integration.

Loom may still run reviewed read-only static workflows.
Its JSONL streams, result files, and Markdown views are optional human or audit
evidence for native harness delegation.
They never gate dispatch, continuation, retry, join, or completion.

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
- **Rust boundary scope:** Every registered portable Rust module root.
  The catalog derives this exact sorted scope from registered module ownership.
- **Generated output scope:** Both binding directories in `nook-web-shared`.
  `nook-app/nook-platform/nook-wasm/Taskfile.yml` owns their build contract.
  `wasm:build` is sealed, `wasm:build:fast` materializes workspace outputs,
  and `wasm:build:prod` is the production selector.
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
- **Skills:** The profile receives one exact fixed bundle.
  - `module-expert` owns read-only module analysis.
  - `design-taste-frontend` owns production Svelte interface guidance.
  - `browser-extension-release-security` owns extension release boundaries.
- **Skill routing:** Every `web_expert` invocation receives the full bundle.
  The catalog audit rejects missing, reordered, or additional skill paths.
- **Skill authority:** `design-taste-frontend` is complete in its executable
  skill card. `browser-extension-release-security` routes to a canonical
  Cortex authority. The exact-commit snapshot contains both the executable
  cards and that linked authority.
- **Canonical skill context:** The fixed profile adds these exact authorities.
  - `.cortex/AGENTS.md`
  - `.cortex/teams/security/dynamic-skills/browser-extension-release-security.md`
  - `.cortex/teams/ai/dynamic-skills/module-expert.md`
  - `.cortex/teams/ai/workflows/module-oriented-development.md`
- **Product specification scope:** The profile receives every exact
  user-facing product authority that can own production web work.
  - `authenticator-items.md`
  - `browser-extension.md`
  - `credit-card-items.md`
  - `decentralized-auth.md`
  - `devices-and-access.md`
  - `file-attachments.md`
  - `password-envelope.md`
  - `password-manager.md`
  - `secure-notes.md`
  - `slip39-recovery.md`
  - `vault-app-isolation.md`
- **Extension release authority:** The profile receives only the exact
  release-critical paths required by its extension security skill.
  - `.github/scripts/ci-release-verify-extension.sh`
  - `.github/workflows/main.yml`
  - `.github/workflows/pr.yml`
  - `.github/workflows/release.yml`
  - `.task/ci-workflows.yml`
  - `Taskfile.yml`
  - `nook-app/ci/Taskfile.yml`
- **Validation:** `web:check`, `web:test`, and `extension:check`.
- **Negative space:** `nook-web-research`, generated-binding adaptation,
  monorepo setup policy, unrelated product records, and unrelated CI files.

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

- malformed role definitions and runtime routing drift;
- missing or duplicate production-module routes;
- missing authority, skill, authored scope, or entry-point paths;
- generated scope producer, selector, or marker drift;
- production routing for `nook-web-research`;
- any recursively discovered uncataloged or symlinked project role;
- a separate WASM or bridge role;
- incomplete `internal_api_expert` scope.
