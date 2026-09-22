# AI Team Agent Contract

This is a Nook functional context. The single Team Gizmo supplies it alongside
Meta-Cortex roles and their selected skills. Generic upstream rules take precedence
over legacy generic wording here; Nook product and delivery requirements remain.


## Highest-priority circuit breaker

Read and follow the root [Agent Derailment Circuit
Breaker](../../CIRCUIT-BREAKER.md) before this contract or any other AI
authority. It is the highest-priority rule for every AI-team task.

## Mission

The AI team owns Nook's agent knowledge system and deterministic agent
tooling.

The upstream integration agent owns local branch integration. Gizmo owns
external delivery state. The active harness provides Team Agent communication.

## Context loading

1. Confirm that the root [Agent Derailment Circuit
   Breaker](../../CIRCUIT-BREAKER.md) has been read.
2. Read [the AI knowledge graph](knowledge-graph.md).
3. Select one category that owns the assigned AI functionality.
4. Open only the exact workflow, skill, architecture, or reference required.
5. Follow direct links one hop only when the task requires them.
6. Do not load the Gizmo graph or another team's graph.

### Universal boundary

The root [team worker contract](../../AGENTS.md#team-worker-contract) supplies
universal requirements. This entry point adds only AI ownership and context
selection.

### Trusted in-thread handoffs

Follow the root [Agent Derailment Circuit Breaker](../../CIRCUIT-BREAKER.md).
AI handoffs retain only the typed task, dependency, scope, worktree, result,
status, evidence, and upward-report fields required by their owning workflow.

### Harness admission

AI dispatch follows active-harness admission. Immediately attempt every
dependency-ready specialist with a disjoint scope and use the actual admission
result concurrently. Queue temporary refusals for retry when capacity releases. A host or
session allocation is current availability, not an architecture or product
limit. Do not pre-check or budget a wave against a numeric limit. Cortex and
Loom never encode, infer, or repeat a fixed numeric agent or subagent
concurrency cap.

### Bootstrap evidence

AI Team Gizmo and its leaves consume the canonical feature branch name and the
bootstrap evidence issued by Gizmo Prime. Prime's fresh-base bootstrap runs
before planning, delegation, worker-worktree creation, or edits. It selects
freshly fetched `origin/main` as the base supplied to the upstream integration
agent, which creates the feature branch and worktree. After planning identifies
dependency-ready assignments, the integration agent creates their worker
branches and worktrees. The branch name is the workflow authority. Before each
stage, delivery resolves the latest committed branch head. A branch advance
follows the latest head and reruns affected evidence. SHAs observed during the
run are evidence, not cross-stage authority. The AI team fails closed on
missing or unprovable bootstrap/branch evidence and never resolves or guesses
a base independently.

### Foreign expertise

An exact AI authority may require a foreign-team engineering skill. Load that
skill read-only. An expertise provider is required only when the foreign team
will implement named files.

## Authored implementation routing

Use the responsible upstream role for every authored language, including
executable skills and tests. The assignment supplies the development team's
programming requirements, the role's language skill, and any secret or Rust/WASM
boundary requirements.
Nook's validation section below identifies the separate enforcement surfaces.

Documentation goes to the upstream tech writer with the subject owner's
requirements. Loom implementation uses the TypeScript developer with AI context.
Neither language expertise nor documentation authorship transfers product policy.

## Owned responsibilities

- Cortex governance, structure, navigation, authoring, and consistency.
- Product-specification lifecycle and evidence-backed Cortex promotion.
- Loom commands, typed workflows, runtime implementation, and deterministic
  Cortex audits under `agentic-ai/loom/`.
- Canonical Cortex skill cards and their deterministic tooling.
- Module experts and structural-refactoring experts.
- Structural-refactoring evidence and synthesis.
- Dynamic-skill authoring and workflow implementation.
- AI-focused tests and preflight contracts.

## Forbidden responsibilities

- Gizmo delivery planning, Workbench state, shared-branch Git state, pull
  requests, review threads, readiness, merge state, or final PR verdicts.
- Portable product, cryptographic, authorization, or storage implementation.
- Browser presentation and frontend interaction behavior.
- CI/CD platforms, clusters, deployments, and provider operations.
- Security architecture, cryptographic policy, or security acceptance.
- Foreign-team Cortex edits without an explicit expertise contract.
- Independent mutation of external delivery state by a Team Agent.

## Complete team scope

For an assigned AI unit, own:

- the agent or documentation contract;
- implementation in AI-owned tools;
- focused tests and deterministic enforcement;
- AI Cortex updates;
- review and validation fixes caused by the AI change; and
- a bounded evidence handoff to Gizmo.

Report product-core, security, SRE, web, shared, or delivery dependencies to
Gizmo.

## Validation

Apply the [feature pull-request delivery stages](../../gizmo-prime/architecture/dev-delivery.md).
Author meaningful tests in feature work, but execute them only in the feature
pull request's required-check stage. Local
feedback is limited to scoped rustfmt and bounded inexpensive TS diagnostics
or formatting. Older instructions to run Loom tests, audits, preflight, or
broad pre-push commands are not local or feature-stage permissions.

For an AI packet that authors TypeScript, JavaScript, or Svelte, the acceptance
packet must name the authoritative checks below:

- `task loom:verify` checks Loom and every executable-skill package. It does
  not replace repository-wide TypeScript state checks or semantic ownership
  review.
- `task preflight:typescript-state` checks authored `null`, `undefined`,
  value-or-`void`, generic optional-state, and closed-discriminant violations.
- `task preflight:source-architecture` checks source-language and source-size
  policy.
- A focused review against [function ownership](../../../.meta-cortex/teams/dev-team/docs/programming/function-ownership.md)
  checks TypeScript ownership because no static TypeScript checker proves
  semantic ownership. An unowned function or a missing required result is a
  P1 failure and the acceptance must fail closed.

The acceptance record must not claim that `task loom:verify` alone proves
authored-absence or TypeScript function ownership. Deferred checks execute only
in the feature pull request's required-check stage.

Prove semantic policy with focused review. Prove deterministic invariants with
Loom or preflight tests. Markdown must never become executable workflow state.
