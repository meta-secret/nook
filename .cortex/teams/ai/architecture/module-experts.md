# Module Expert Registry

## Overview

This registry routes feature work to reusable, read-only domain experts.

The registry does not grant write authority.
It does not schedule work.
It does not replace package responsibilities in
[packages.md](../../../shared/architecture/packages.md).

Universal worker behavior follows the root
[team worker contract](../../../AGENTS.md#team-worker-contract) and
[subagent delegation](../../../gizmo/workflows/subagent-delegation.md).

## Engineering team routing

Every module expert runs inside one engineering-team ownership domain.
Every task records one mandatory team identity separately from its registered
expert.

- Portable Rust, companion-domain, core, and Rust/WASM bridge evidence routes
  through the development-core team graph.
- Production web evidence routes through the web-development team graph.
- Infrastructure and CI are excluded from this production module registry and
  route through the SRE team graph.
- The internal API expert may inspect an accepted provider-consumer boundary
  across teams. It remains read-only and cannot transfer ownership.

Gizmo selects the team and acceptance context, admission-authorizes the bounded
expert-role task, and submits its contract to the active harness. In this
registry, **invoke** means that submission followed by the harness creating and
running the attempt; it never means Gizmo creates or runs a worker.
The expert must not expand into another team's implementation scope.

## Registry contract

Each named role contract defines:

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
This Cortex registry is the semantic authority for role capability and context.
The typed catalog is a deterministic implementation mirror.

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

Every invocation follows the universal worker contract.
This registry adds:

- one stable semantic expert role;
- a bounded read-only evidence surface;
- task-selected authority and skill context;
- module resource claims; and
- role-specific acceptance evidence.

Native semantic evidence, optional `ModuleExpertEvidence`, and `parentActions`
remain recommendations. They do not authorize descendants, writes,
integration, or lifecycle changes.

Role contracts preserve two structural rules:

- Every role is read-only.
- Every role loads only the context named by this registry and its bounded task
  contract.

The stable role name identifies semantic expertise.
It is not a native worker label or harness configuration key.

Write-capable module tasks are separate implementation assignments governed by
subagent delegation.

Loom may still run reviewed read-only expert and audit workflows.
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
- **Allowed skill catalog:** The task selects the smallest applicable set.
  - `module-expert` is always required for module analysis.
  - `.cortex/teams/web-dev/dynamic-skills/ui-design-skills.md` is required for
    user-visible Svelte or interaction work.
  - `browser-extension-release-security` is required when hosted extension
    origins, identity, archives, redirects, injection exclusions, isolated
    browser profiles, or release artifacts are in scope.
- **Skill routing:** The role rejects skills outside the allowed catalog.
  It also rejects a task that omits an applicable required skill.
- **Selection field:** `selectedContextPaths` carries optional product
  authorities, release authorities, and task-applicable skill paths.
  - An empty selection represents ordinary module analysis.
  - Selecting a product authority requires `ui-design-skills`.
  - Selecting a release authority requires
    `browser-extension-release-security` and its canonical security authority.
  - The role rejects duplicate, reordered, unknown, or incomplete selections.
- **Skill authority:** `ui-design-skills` and
  `browser-extension-release-security` remain complete in their owning Cortex
  cards. The task-selected snapshot includes the security authority when the
  security skill is required.
- **Base context:** Every invocation receives these authorities.
  - `.cortex/teams/web-dev/AGENTS.md`
  - `.cortex/teams/web-dev/knowledge-graph.md`
  - `.cortex/teams/ai/dynamic-skills/module-expert.md`
  - `.cortex/gizmo/workflows/module-oriented-development.md`
- **Allowed product authority catalog:** The task selects only the authorities
  that own its assigned functionality.
  - `.cortex/teams/dev-core/product-specs/authenticator-items.md`
  - `.cortex/teams/web-dev/product-specs/browser-extension.md`
  - `.cortex/teams/dev-core/product-specs/credit-card-items.md`
  - `.cortex/teams/dev-core/product-specs/decentralized-auth.md`
  - `.cortex/teams/dev-core/product-specs/devices-and-access.md`
  - `.cortex/teams/dev-core/product-specs/file-attachments.md`
  - `.cortex/teams/dev-core/product-specs/password-envelope.md`
  - `.cortex/teams/dev-core/product-specs/password-manager.md`
  - `.cortex/teams/dev-core/product-specs/secure-notes.md`
  - `.cortex/teams/dev-core/product-specs/slip39-recovery.md`
  - `.cortex/teams/web-dev/product-specs/vault-app-isolation.md`
- **Extension release authority:** When extension release security is
  required, the task selects only the relevant release paths from this
  catalog.
  - `.github/scripts/ci-release-verify-extension.sh`
  - `.github/workflows/main.yml`
  - `.github/workflows/pr.yml`
  - `.github/workflows/release.yml`
  - `.task/ci-workflows.yml`
  - `Taskfile.yml`
  - `nook-app/ci/Taskfile.yml`
- **Security routing:** A task cannot omit
  `browser-extension-release-security` or its canonical security authority when
  an extension release boundary is in scope.
- **Validation:** `web:check`, `web:test`, and `extension:check`.
- **Negative space:** `nook-web-research`, generated-binding adaptation,
  monorepo setup policy, unrelated product records, and unrelated CI files.

Split this grouped role only when stable public interfaces and disjoint
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

- malformed typed catalog entries or drift from this Cortex registry;
- missing or duplicate production-module routes;
- missing authority, skill, authored scope, or entry-point paths;
- a `web_expert` skill outside its allowed catalog;
- a missing task-required web or extension-security skill;
- a `web_expert` product or release authority outside its allowed catalog;
- unbounded web product or release context that the task does not require;
- generated scope producer, selector, or marker drift;
- production routing for `nook-web-research`;
- any uncataloged executable role;
- a separate WASM or bridge role;
- incomplete `internal_api_expert` scope.
