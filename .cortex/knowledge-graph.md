# Cortex Context Router

Use this file only to select one owning context. Do not preload every linked
graph.

## Entry contract

- [Agent routing contract](AGENTS.md) defines the mandatory loading boundary.

## Team routes

Choose the team that owns the requested functionality.

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

1. Select one primary team before opening another graph.
2. Load that team's `AGENTS.md` and knowledge graph.
3. Open only documents needed for the assigned functionality.
4. Load a shared document only for a named cross-team dependency.
5. Do not open another team's graph for background context.
6. Return foreign-team requirements to Gizmo.
7. Load a foreign-team skill read-only when the selected team's task-relevant
   authority names it as required engineering policy.
8. Require an expertise contract only when the foreign team will change files.
9. Route security architecture and acceptance questions to security without
   transferring implementation ownership from the functional team.

For a multi-team request, Gizmo creates one task for each required team
subagent. Each team subagent receives only its own context.
