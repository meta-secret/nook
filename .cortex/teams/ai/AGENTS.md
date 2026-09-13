# AI Team Agent Contract

## Mission

The AI team owns Nook's agent knowledge system and deterministic agent
tooling.

Gizmo owns shared-branch sequencing and external delivery state. The active
harness provides Team Agent communication.

## Context loading

1. Read [the AI knowledge graph](knowledge-graph.md).
2. Select one category that owns the assigned AI functionality.
3. Open only the exact workflow, skill, architecture, or reference required.
4. Follow direct links one hop only when the task requires them.
5. Do not load the Gizmo graph or another team's graph.

The root [team worker contract](../../AGENTS.md#team-worker-contract) supplies
universal requirements. This entry point adds only AI ownership and context
selection.

AI dispatch follows active-harness admission. Immediately attempt every
dependency-ready specialist with a disjoint scope and use the actual admission
result concurrently. Queue temporary refusals for retry when capacity releases. A host or
session allocation is current availability, not an architecture or product
limit. Do not pre-check or budget a wave against a numeric limit. Cortex and
Loom never encode, infer, or repeat a fixed numeric agent or subagent
concurrency cap.

AI Team Gizmo and its leaves consume the `pinnedLocalDevSha` issued by Gizmo
Prime. Prime's fresh-base bootstrap runs before planning, delegation, worktree
creation, or edits. It records `originMainSha` for the fetched `origin/main`
and `pinnedLocalDevSha` after canonical local `main` and `dev` are synchronized.
The AI team fails closed on missing, mismatched, or stale evidence and never
resolves or guesses a base independently.

An exact AI authority may require a foreign-team engineering skill. Load that
skill read-only. An expertise provider is required only when the foreign team
will implement named files.

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

Apply the [dev delivery stages](../../gizmo-prime/architecture/dev-delivery.md).
Author meaningful tests in feature work, but execute them only in the manager's
slow PR stage. Feature validation is remote build-only execution only. Local
feedback is limited to scoped rustfmt and bounded inexpensive TS diagnostics
or formatting. Older instructions to run Loom tests, audits, preflight, or
broad pre-push commands are not local or feature-stage permissions.

Prove semantic policy with focused review. Prove deterministic invariants with
Loom or preflight tests. Markdown must never become executable workflow state.
