# Cortex Context Router

Use this file only to select one owning context. Do not preload linked graphs.

## Entry contract

- [Agent routing contract](AGENTS.md) defines universal loading, ownership,
  authoring, and delivery boundaries.

## Owning contexts

- [Gizmo Prime](gizmo/knowledge-graph.md): planning, delegation, integration,
  review coordination, Workbench, pull requests, readiness, and merge.
- [AI](teams/ai/knowledge-graph.md): Cortex, Loom, agent skills, workflows,
  routing, and AI automation.
- [Development core](teams/dev-core/knowledge-graph.md): portable Rust, vault
  behavior, security-control implementation, and typed WASM contracts.
- [Security](teams/security/knowledge-graph.md): security architecture,
  cryptographic policy, trust boundaries, and security review.
- [SRE](teams/sre/knowledge-graph.md): CI/CD, clusters, deployments, runners,
  containers, and operations.
- [Web development](teams/web-dev/knowledge-graph.md): TypeScript, Svelte,
  browsers, frontend behavior, and extension interaction.

## Shared dependency route

[Shared knowledge](shared/knowledge-graph.md) contains genuinely cross-team
architecture, catalogs, references, and engineering rules. Load it only for a
named dependency, then return to the selected owning context. Return a
foreign-team write requirement to Gizmo Prime.
