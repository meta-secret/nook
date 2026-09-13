# Cortex Context Router

Use this file only to select one owning context. Do not preload linked graphs.

## Entry contract

- [Agent routing contract](AGENTS.md) defines universal loading, ownership,
  authoring, and delivery boundaries.

## Canonical tree

Gizmo Prime lives at `gizmo-prime/`. Its six and only six top-level teams are
`teams/ai/`, `teams/dev-core/`, `teams/security/`, `teams/sre/`,
`teams/web-dev/`, and `teams/delivery-pipeline/`. Each team has one `gizmo/`
that reports to Prime and uses `gpt-5.6-luna` with `xhigh` reasoning. Each Team
Gizmo owns one team worktree; Prime reuses a compatible existing Team Agent
before spawning and otherwise issues separate child worktrees per specialist.
Team Gizmo integrates specialist commits into its feature branch.

Current specialist routing includes SRE (`teams/sre/provisioning/` and
`teams/sre/cloud-native/`), Development Core
(`teams/dev-core/rust-core-developer/` and
`teams/dev-core/rust-auth2-developer/`), and Delivery Pipeline
(`teams/delivery-pipeline/gizmo/`, `teams/delivery-pipeline/dev-manager/`, and
`teams/delivery-pipeline/pr-lifecycle/`).

## Owning contexts

- [Multiagent delivery architecture](gizmo-prime/architecture/multiagent-delivery-diagrams.md):
  mandatory primary explanation for the complete feature, check, local-dev,
  dev-validation, and promotion workflow.
- [Delivery Pipeline](teams/delivery-pipeline/knowledge-graph.md): operational
  delivery mechanics. Its Team Gizmo is
  [here](teams/delivery-pipeline/gizmo/knowledge-graph.md); the
  [Dev Manager](teams/delivery-pipeline/dev-manager/knowledge-graph.md) alone
  invokes `dev:pr-manager`, and the
  [PR Lifecycle Agent](teams/delivery-pipeline/pr-lifecycle/knowledge-graph.md)
  performs only authorized mechanics.
- [Dev delivery architecture](gizmo-prime/architecture/dev-delivery.md): canonical
  feature compilation, local integration, and dev-to-main contract.
- [Gizmo Prime](gizmo-prime/knowledge-graph.md): planning, delegation, integration,
  feature review, feature acceptance, local landing requests, and Workbench.
- [Delivery Pipeline](teams/delivery-pipeline/knowledge-graph.md): operational
  delivery mechanics across CI, pull-request lifecycle, dev publication,
  workflow execution, local landing, evidence, and guarded promotion.
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
