# Engineering Team Ownership

## Purpose

Nook divides implementation responsibility across three engineering teams.

The split controls:

- code and Cortex ownership;
- team-agent routing;
- cross-team contracts;
- test responsibility; and
- review-fix responsibility.

One delivery owner retains the shared integration and lifecycle join.

## Team boundaries

### Development core

Development core owns portable application behavior and security-sensitive domain logic.

- **Primary code:**
  - portable Rust crates under `nook-app/nook-platform/`;
  - Rust-owned domain tests;
  - typed WASM bridges when their change begins from a core contract; and
  - generated binding contracts consumed by web packages.
- **Primary Cortex:** `.cortex/dev-core/`.
- **Responsibilities:**
  - identity, authorization, replication, event logs, vaults, and cryptography;
  - validation and business rules;
  - storage schemas and migrations owned by Rust/WASM;
  - public DTO and bridge contracts; and
  - behavior-focused Rust and WASM tests.
- **Forbidden ownership:**
  - browser presentation and interaction policy;
  - CI/CD, runner, cluster, deployment, and provider operations; and
  - another team's Cortex authorities.

### Site reliability engineering

SRE owns build, validation, deployment, and runtime infrastructure.

- **Primary code:**
  - `.github/` workflows and CI helpers;
  - `infra/` clusters, manifests, providers, deployments, and operations;
  - root and subsystem Task orchestration for CI or infrastructure;
  - container, runner, cache, and release configuration; and
  - infrastructure-focused preflight contracts.
- **Primary Cortex:** `.cortex/sre/`.
- **Responsibilities:**
  - CI/CD pipelines and exact-head validation mechanics;
  - k0s, Kubernetes, ARC, Kata, and deployment systems;
  - build images, caches, runners, and release operations;
  - operational credentials and provider boundaries; and
  - infrastructure and pipeline tests.
- **Forbidden ownership:**
  - product business rules;
  - browser presentation behavior; and
  - another team's Cortex authorities.

### Web development

Web development owns browser presentation and frontend interaction behavior.

- **Primary code:**
  - web applications and shared presentation packages under `nook-app/nook-web/`;
  - browser-extension presentation, content scripts, and service-worker integration;
  - Svelte and TypeScript adapters that consume typed Rust/WASM contracts;
  - frontend unit, browser, accessibility, and visual tests; and
  - user-interface demos.
- **Primary Cortex:** `.cortex/web-dev/`.
- **Responsibilities:**
  - frontend state and rendering;
  - accessibility, responsive behavior, and interaction design;
  - browser-extension user journeys and release-facing presentation;
  - safe consumption of public Rust/WASM DTOs; and
  - browser-visible regression evidence.
- **Forbidden ownership:**
  - portable validation, cryptography, authorization, and vault-storage rules;
  - CI/CD, cluster, deployment, and provider operations; and
  - another team's Cortex authorities.

## Common and serialized ownership

Common Cortex contains policy that genuinely governs every team.

- Agent delegation and delivery workflows remain common.
- Cross-team package and module registries remain common.
- Documentation, consistency, review, and Workbench protocols remain common.
- Shared integration files remain serialized under the delivery owner.

Shared integration files include:

- root manifests and lockfiles;
- generated bindings;
- cross-team registries;
- the root knowledge graph;
- pull-request and Workbench lifecycle state; and
- validation, readiness, and merge state.

A team agent may propose a required shared-file change.
The delivery owner decides its integration order and final writer.

## Scope classification procedure

The delivery owner classifies the human request before implementation starts.

1. Describe the observable functionality without assigning files yet.
2. Split the functionality by durable responsibility.
3. Map each unit to one team boundary.
4. Identify every cross-team provider and consumer contract.
5. Freeze the contract, baseline, write scope, tests, and acceptance evidence.
6. Assign each independent unit to its team agent when bounded delegation is available.
7. Keep shared files and lifecycle state in the parent-owned join.

File location does not override semantic ownership.

- A TypeScript validation rule that belongs in portable Rust routes to development core.
- A Rust helper used only to validate infrastructure manifests routes to SRE.
- A CI change required by a web test routes to SRE after web development reports the dependency.

## Cross-team dependency protocol

A team agent must stop at another team's boundary.

It reports a dependency containing:

- the requested capability;
- the provider team;
- the consumer contract;
- the reason the current team cannot own it;
- acceptance evidence; and
- the blocked or deferred consumer work.

The team agent must not implement the provider inside its own layer.
The delivery owner routes the dependency to the provider team and updates the frozen work graph.

## End-to-end team responsibility

Within its declared scope, each team agent owns the complete technical result.

That responsibility includes:

- implementation;
- team-owned scripts and configuration;
- team-owned Cortex updates;
- behavior and regression tests;
- fixes for review findings in the team's scope;
- fixes for validation failures caused by the team's change; and
- a bounded semantic handoff with evidence.

The delivery owner retains external lifecycle mutations.

- Team agents may diagnose review comments and implement their scoped fixes.
- Only the delivery owner replies, resolves conversations, pushes the integrated branch, triggers shared checks, declares readiness, or merges.

## Validation

The final integration must prove:

- every changed path has one responsible team;
- no team agent changed another team's code or Cortex;
- cross-team contracts were frozen before consumer integration;
- each team supplied its own tests and review fixes;
- shared files were serialized; and
- the root delivery owner validated the integrated exact head.
