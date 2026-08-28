# Engineering Team Ownership

## Purpose

Nook divides responsibility across five engineering teams.

The split controls code, Cortex, agent routing, contracts, tests, and review-fix
responsibility.

Gizmo retains shared integration and delivery actions.

## Ownership dimensions

Every capability has one functional owner.

- Gizmo may own coordination, integration, or lifecycle capabilities.
- One engineering team owns every implementation capability.
- Gizmo is never an implementation expertise provider.

- The functional owner defines capability semantics, consumer contracts,
  security boundaries, Cortex authority, and acceptance evidence.
- File location is evidence of normal ownership. It does not prevent explicit
  expertise delegation.

A capability may also require one expertise provider.

- Gizmo creates a separate delegated expertise task.
- The task's exactly one team identity is the expertise-provider team.
- The task records the functional-owner team as acceptance metadata and
  acceptance owner. Functional ownership is not a second task identity.
- The provider changes the named files after Gizmo freezes the functional
  contract.
- Its task scope names the frozen contract and allowed code and test files.
- It owns implementation quality, focused tests, review fixes, and validation
  fixes inside that scope.
- It does not own consumer-team Cortex, capability semantics, shared files, or
  delivery lifecycle state.
- It returns its semantic handoff to the functional owner for acceptance before
  Gizmo integrates it.

Expertise delegation is task-scoped. It does not permanently transfer a file,
module, or capability to the provider team.

Team identity is task-scoped.

- Gizmo assigns exactly one team identity to each bounded task.
- A mission may reach many tasks with the same or different team identities.
- Discovery creates task records. It does not create worker attempts.
- Each ready selected task receives one worker attempt.
- Every attempt leases its claims until Gizmo conclusively dispositions its
  output.
- Accepted write output is verified and integrated before release.
- Accepted read-only evidence is verified and accepted into parent state before
  release.
- Rejected or cancelled output is recorded as unusable before release.
- A consumer lease includes relied-on evidence-surface claims.
- Worker attempt count follows ready selected tasks. It does not follow team
  count.
- Team ownership does not collapse several tasks into one mission-wide worker.
- Operational semantics follow
  [subagent delegation](../workflows/subagent-delegation.md).

Skill ownership is separate from implementation delegation.

- A functional owner may load a specifically linked foreign-team skill as
  read-only engineering policy.
- It may apply that policy while implementing its own capability.
- An expertise contract is required only when a subagent from the skill-owning
  team will change files.

## Team boundaries

### Gizmo delivery control

Gizmo owns coordination, integration, and lifecycle capabilities.

- **Primary Cortex:** `.cortex/gizmo/`.
- **Primary state:** Workbench, integrated Git state, pull requests, review
  threads, validation requests, readiness, and merge state.

Gizmo must not implement a team capability or fix.

### Development core

Development core owns portable application behavior and security-sensitive domain logic.

- **Primary code:**
  - portable Rust crates under `nook-app/nook-platform/`;
  - Rust-owned domain tests;
  - typed WASM bridges when their change begins from a core contract; and
  - generated binding contracts consumed by web packages.
- **Primary Cortex:** `.cortex/teams/dev-core/`.
It must not own browser presentation, infrastructure operations, or another
team's Cortex authorities.

### Site reliability engineering

SRE owns build, validation, deployment, and runtime infrastructure.

- **Primary code:**
  - `.github/` workflows and CI helpers;
  - `infra/` clusters, manifests, providers, deployments, and operations;
  - root and subsystem Task orchestration for CI or infrastructure;
  - container, runner, cache, and release configuration; and
  - infrastructure-focused preflight contracts.
- **Primary Cortex:** `.cortex/teams/sre/`.
It must not own product rules, browser presentation, or another team's Cortex
authorities.

### Security

Security owns cross-team security architecture and assurance.

- **Primary responsibilities:**
  - cryptographic policy and mechanism inventory;
  - key ownership and lifecycle architecture;
  - trust boundaries and protected-material rules;
  - security-specific review and release skills; and
  - security acceptance criteria for cross-team changes.
- **Primary Cortex:** `.cortex/teams/security/`.

Security does not automatically own implementation files. Development core,
web development, SRE, and AI retain implementation ownership in their normal
layers. Security owns the invariant and acceptance evidence.

### Web development

Web development owns TypeScript and Svelte engineering expertise. It also owns
browser presentation and frontend interaction behavior.

- **Primary code:**
  - web applications and shared presentation packages under `nook-app/nook-web/`;
  - browser-extension presentation, content scripts, and service-worker integration;
  - Svelte and TypeScript adapters that consume typed Rust/WASM contracts;
  - general TypeScript modeling, API, state, and refactoring practices;
  - frontend unit, browser, accessibility, and visual tests; and
  - user-interface demos.
- **Primary Cortex:** `.cortex/teams/web-dev/`.
It must not own portable security or storage rules, infrastructure operations,
or another team's Cortex authorities.

Web development may implement a bounded TypeScript unit in AI, SRE, or
development-core code. The functional owner keeps capability semantics and
acceptance.

### AI

AI owns the agent knowledge system and deterministic agent tooling.

- **Primary code:**
  - Loom commands, audits, typed workflows, and orchestration under
    `agentic-ai/loom/`;
  - canonical Cortex skill cards and deterministic agent tooling;
  - module and structural expert semantic contracts;
  - agent-focused prompts and preflight contracts; and
  - AI workflow tests.
- **Primary Cortex:** `.cortex/teams/ai/`.

AI owns Cortex governance, authoring rules, consistency, navigation, and
deterministic agent tooling. Gizmo owns mission planning, team routing,
subagent coordination, review coordination, PR delivery, readiness, and merge.
AI must not implement portable product behavior, browser presentation, or
infrastructure operations.

## Shared and serialized ownership

Shared Cortex contains knowledge that genuinely serves multiple teams.

- Cross-team package architecture remains shared.
- Global product and reference catalogs remain shared.
- Ownerless cross-team language and test policy remains shared.
- TypeScript implementation practices belong to web development even when AI
  or SRE code consumes them.
- Agent protocols, expert registries, and Cortex rules belong to AI.
- Shared integration files remain serialized under Gizmo.

Shared integration includes root manifests, lockfiles, generated bindings,
cross-team registries, the root graph, and delivery lifecycle state.

A team agent may propose a required shared-file change.
Gizmo decides the integration order and assigns the final writer.

## Scope classification procedure

Gizmo assigns the human request before implementation starts.

1. Describe the observable functionality without assigning files yet.
2. Recursively discover concrete task records and their provider dependencies.
3. Assign coordination, integration, and lifecycle capabilities to Gizmo.
4. Assign each implementation task to AI, development core, security, SRE, or
   web development.
5. When another team's implementation expertise is required, create a separate
   task with that provider team as its only team identity.
6. Identify every cross-team provider and consumer contract.
7. Freeze the initial known graph, contracts, functional-owner acceptance
   metadata, resource claims, forbidden scope, tests, evidence surfaces, and
   acceptance evidence.
8. Assign exactly one team identity to every reached task.
9. Apply the canonical delegation workflow.
11. Snapshot exact starting frontiers for selected tasks.
12. Create one worker attempt for each selected task.
13. Keep shared files and lifecycle state in the parent-owned join.

File location does not override semantic ownership.

- A TypeScript validation rule that belongs in portable Rust routes to development core.
- A Rust helper used only to validate infrastructure manifests routes to SRE.
- A CI change required by a web test routes to SRE after web development reports the dependency.
- A Cortex audit or Loom change routes to AI after another team reports the
  documentation or automation dependency.
- A Loom TypeScript refactor remains an AI capability. AI may ask a
  web-development subagent to change named TypeScript files.
- A cryptographic format or trust-boundary change requires security acceptance.
  Its Rust, web, infrastructure, or agent implementation remains with the
  corresponding functional team.

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

If the provider was absent from the frozen graph, Gizmo applies the immutable
generation restart in
[subagent delegation](../workflows/subagent-delegation.md#immutable-generation-restart).

## Cross-team expertise protocol

Expertise delegation applies when the functional contract is already owned but
another team has the implementation discipline needed to realize it safely.

1. Keep one functional owner for the capability.
2. Create a separate expertise implementation task.
3. Give that task exactly one team identity: the expertise-provider team.
4. Record the functional-owner team as acceptance metadata and acceptance
   owner, not as another task identity.
5. Freeze the accepted input contract and observable output.
6. Declare exact code and test paths the provider may change.
7. Declare consumer Cortex, capability semantics, shared files, and lifecycle
   state forbidden.
8. Give the worker only the provider team's `AGENTS.md`, knowledge graph, and
   task-relevant authorities. Supply the frozen consumer contract as read-only
   task metadata; do not load the consumer team's graph.
9. Let the expertise provider implement, test, and repair review or validation
   findings inside that scope.
10. Return a semantic handoff to the functional owner. The provider cannot
    redefine the functional contract.
11. Let the functional owner accept or reject capability behavior before Gizmo
    performs the parent-owned integration join.

This contract makes the delegated files part of the provider's owned task
scope. It does not grant general access to the consumer team's code.

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

Gizmo retains external lifecycle mutations.

- Team agents may diagnose review comments and implement their scoped fixes.
- Only Gizmo replies, resolves conversations, pushes the integrated branch,
  triggers shared checks, declares readiness, or merges.

## Validation

The final integration must prove:

- every changed path has one responsible team;
- every capability has one functional owner;
- every expertise implementation is a separate task with exactly one team
  identity equal to its provider team;
- every expertise task names its functional owner as acceptance metadata and
  acceptance owner;
- every changed security boundary has named security acceptance evidence;
- no expertise provider changed consumer Cortex, capability semantics, shared
  files, or undeclared code;
- every expertise worker loaded only its provider-team graph plus the frozen
  read-only consumer contract;
- every expertise handoff was accepted by the functional owner before Gizmo
  integration;
- cross-team contracts were frozen before consumer integration;
- each team supplied its own tests and review fixes;
- shared files were serialized;
- every reached task had one team identity;
- every ready selected task had one worker attempt and an exact frontier;
- every lease release followed a conclusive output disposition;
- every read-only task declared an evidence surface;
- every successor Git frontier contained its full write-predecessor closure;
- every successor had accepted and current read-only predecessor evidence in
  parent task state; and
- canonical delegation acceptance criteria passed;
- Gizmo validated the integrated exact head.
