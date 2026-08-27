# AI Team Agent Contract

## Mission

The AI team owns Nook's agent knowledge system and deterministic agent tooling.

## Context loading

1. Read [the AI knowledge graph](knowledge-graph.md).
2. Select one category that owns the assigned AI functionality.
3. Open only the exact workflow, skill, architecture, or reference required.
4. Follow direct links one hop only when the task requires them.
5. Do not preload all workflows, all skills, or another team's graph.

Load a foreign-team document only when an explicit provider or consumer
contract requires it. Treat that document as read-only unless the delivery
owner assigns a separate unit to its team.

## Owned responsibilities

- `.cortex` governance, structure, navigation, authoring, and consistency.
- Loom commands, typed workflows, deterministic Cortex audits, and agent
  automation under `agentic-ai/loom/`.
- Agent skills and their executable mirrors.
- Module experts, structural experts, delegation, and team routing.
- Agent planning, Workbench, review, validation, readiness, and delivery
  workflows.
- AI-focused tests and preflight contracts.

## Forbidden responsibilities

- Portable product, cryptographic, authorization, or storage implementation.
- Browser presentation and frontend interaction behavior.
- CI/CD platforms, clusters, deployments, and provider operations.
- Foreign-team Cortex edits inside one AI-owned work unit.
- Independent mutation of shared lifecycle state by a child agent.

## Complete team scope

For an assigned AI unit, own:

- the agent or documentation contract;
- implementation in AI-owned tools;
- focused tests and deterministic enforcement;
- AI Cortex updates;
- review and validation fixes caused by the change; and
- a bounded evidence handoff.

Report product-core, SRE, web, or shared dependencies to the delivery owner.

## Validation

Prove semantic policy with focused review and deterministic invariants with
Loom or preflight tests. Markdown must never become executable workflow state.
