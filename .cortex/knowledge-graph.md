# Cortex Context Router

Use this file only to select one owning context. Do not preload linked graphs.

## Entry contract

- [Agent routing contract](AGENTS.md) defines universal loading, ownership,
  authoring, and delivery boundaries.

## Owning contexts

- [Multiagent delivery architecture](gizmo/architecture/multiagent-delivery-diagrams.md):
  mandatory primary explanation for the complete feature, check, local-dev,
  dev-validation, and promotion workflow.
- [Dev manager](teams/dev-manager/knowledge-graph.md): manually operated dev
  publication, dev PR creation/update, slow evidence, readiness, repair
  delegation, and fast-forward promotion policy.
- [Dev manager Gizmo](teams/dev-manager-gizmo/AGENTS.md): on-demand entry and
  orchestration context for manually invoked dev-manager work.
  - Load the existing [Dev manager contract](teams/dev-manager/AGENTS.md) and
    [knowledge graph](teams/dev-manager/knowledge-graph.md).
  - Load the [PR Steward contract](teams/pr-steward/AGENTS.md) and
    [knowledge graph](teams/pr-steward/knowledge-graph.md).
  - Preserve the existing dev-manager contract as the canonical operational
    authority. Never bypass the mandatory Gizmo gate or GitHub execution
    boundary.
- [Dev delivery architecture](gizmo/architecture/dev-delivery.md): canonical
  feature compilation, local integration, and dev-to-main contract.
- [Gizmo Prime](gizmo/knowledge-graph.md): planning, delegation, integration,
  feature review, feature acceptance, local landing requests, and Workbench.
- [PR Steward](teams/pr-steward/knowledge-graph.md): authorized review and
  check observation, exact-head evidence, PR status verification, and promotion
  mechanics under the dev manager's packet. It does not create pull requests.
  - [PR Steward contract](teams/pr-steward/AGENTS.md)
  - [Pull-request lifecycle](teams/pr-steward/workflows/pull-request-lifecycle.md)
  - [Authorization handshake](teams/pr-steward/workflows/authorization-handshake.md)
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
