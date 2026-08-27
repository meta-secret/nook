# Cortex Context Router

Use this file only to select one owning context. Do not preload every linked
graph.

## Entry contract

- [Agent routing contract](AGENTS.md) defines the mandatory loading boundary.

## Gizmo route

Choose Gizmo for mission planning, delegation, integration, review
coordination, Workbench, pull requests, readiness, and merge state.

- [Gizmo](gizmo/knowledge-graph.md) owns delivery control and the final
  integrated PR verdict.

## Team routes

Gizmo chooses the team agent that owns the requested functionality.

- [AI](teams/ai/knowledge-graph.md) owns Cortex, Loom, agent skills, agent
  workflows, expert routing, and AI automation.
- [Development core](teams/dev-core/knowledge-graph.md) owns portable Rust,
  vault behavior, security-control implementation, and typed WASM contracts.
- [Security](teams/security/knowledge-graph.md) owns security architecture,
  cryptographic policy, trust boundaries, security review, and
  security-specific skills.
- [SRE](teams/sre/knowledge-graph.md) owns CI/CD, clusters, deployments,
  runners, containers, and operations.
- [Web development](teams/web-dev/knowledge-graph.md) owns TypeScript and Svelte
  engineering expertise, browser presentation, frontend behavior, and
  extension interaction.

## Shared route

- [Shared knowledge](shared/knowledge-graph.md) contains only genuinely
  cross-team architecture, catalogs, references, and engineering rules.

Load shared knowledge only when the selected task depends on a named shared
authority.

## Routing rules

1. Gizmo keeps delivery-control work in its own context.
2. Gizmo recursively discovers bounded functional task records.
3. Gizmo assigns exactly one team identity to each task.
4. Gizmo creates a worker attempt only after the task is ready and its exact
   starting frontier exists.
5. An unknown provider invalidates the affected attempt and returns to Gizmo
   for graph replanning.
6. The assigned worker loads only its own context's `AGENTS.md` and knowledge
   graph.
7. Open only documents needed for the assigned functionality.
8. Load a shared document only for a named cross-team dependency.
9. Do not open another team's graph for background context.
10. Return foreign-team requirements to Gizmo.
11. Load a foreign-team skill read-only when the selected team's task-relevant
   authority names it as required engineering policy.
12. Require an expertise contract only when the foreign team will change files.
13. Route security architecture and acceptance questions to security without
   transferring implementation ownership from the functional team.

For a multi-team request, Gizmo loads only its own graph. Every reached task has
a task record. Every ready selected task receives one worker attempt with only
the context for that task's team identity.
