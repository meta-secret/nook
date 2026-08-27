# AI Team Agent Contract

## Mission

The AI team owns Nook's agent knowledge system and deterministic agent
tooling.

Gizmo owns delivery control and lifecycle state.

## Context loading

1. Read [the AI knowledge graph](knowledge-graph.md).
2. Select one category that owns the assigned AI functionality.
3. Open only the exact workflow, skill, architecture, or reference required.
4. Follow direct links one hop only when the task requires them.
5. Do not load the Gizmo graph or another team's graph.

The root [team worker contract](../../AGENTS.md#team-worker-contract) supplies
universal requirements. This entry point adds only AI ownership and context
selection.

An exact AI authority may require a foreign-team engineering skill. Load that
skill read-only. An expertise provider is required only when the foreign team
will implement named files.

## Owned responsibilities

- Cortex governance, structure, navigation, authoring, and consistency.
- Product-specification lifecycle and evidence-backed Cortex promotion.
- Loom commands, typed workflows, runtime implementation, and deterministic
  Cortex audits under `agentic-ai/loom/`.
- Agent skills and their executable mirrors.
- Module experts and structural-refactoring experts.
- Structural-refactoring evidence and synthesis.
- Dynamic-skill authoring and workflow implementation.
- AI-focused tests and preflight contracts.

## Forbidden responsibilities

- Gizmo delivery planning, Workbench state, integrated Git state, pull
  requests, review threads, readiness, merge state, or final PR verdicts.
- Portable product, cryptographic, authorization, or storage implementation.
- Browser presentation and frontend interaction behavior.
- CI/CD platforms, clusters, deployments, and provider operations.
- Security architecture, cryptographic policy, or security acceptance.
- Foreign-team Cortex edits without an explicit expertise contract.
- Independent mutation of shared lifecycle state by a child agent.

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

Prove semantic policy with focused review. Prove deterministic invariants with
Loom or preflight tests. Markdown must never become executable workflow state.
