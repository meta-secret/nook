# Cortex Context Router

Use this file only to select one owning context. Do not preload linked graphs.

## Entry contract

- [Agent routing contract](AGENTS.md) defines universal loading, ownership,
  authoring, and delivery boundaries.
- [Gizmo Prime](gizmo-prime/AGENTS.md) is the first actor for each new user-originated
  repository task. Follow-ups retain their current Gizmo owner.
- Assigned workers use the owning team context in their bounded packet.
- Gizmo routes manually requested dev operations to the dev manager.

## Canonical tree

Gizmo Prime lives at `gizmo-prime/`. Its six and only six top-level teams are
`teams/ai/`, `teams/dev-core/`, `teams/security/`, `teams/sre/`,
`teams/web-dev/`, and `teams/delivery-pipeline/`. Each team has one `gizmo/`
that reports to Prime. Every Team Gizmo uses `gpt-5.6-sol` with `low` reasoning.
Each Team Gizmo requests Fast mode with `service_tier: fast`, which resolves as
`priority`. Each leaf Team Agent uses `gpt-5.6-luna` with `xhigh` reasoning. It
requests Fast mode with `service_tier: fast`, which resolves as `priority`. Each
leaf receives a separate issued child worktree. Each Team Gizmo owns one team
worktree. Prime reuses a compatible existing Team Agent before spawning.
Otherwise it issues separate child worktrees for required specialists. Team
Gizmo integrates specialist commits into its feature branch.

Before planning, delegation, worktree creation, or edits, Gizmo Prime runs
`git fetch --prune origin`; a fetch failure fails closed. Delivery/Dev Manager
then synchronizes canonical local `main` to the fetched `origin/main` and
brings canonical local `dev` onto or including that main baseline under the
dev-delivery workflow. If local dev is not current with main, the run fails
closed. Prime authorizes the canonical feature branch name, which is the
workflow authority. At creation, Prime starts the feature branch and worktree
from the current committed local-dev feature base and preserves that base.
Base and head SHAs are observational evidence only, not required packet
fields. Delivery re-fetches and resolves the latest committed branch head
before each remote dispatch, review, or landing operation. If the branch
advances, follow the latest head and rerun affected evidence. Team Gizmos and
leaves keep temporary branches private.

Active harness admission is dynamic. Gizmo immediately attempts every
dependency-ready Team Gizmo with a disjoint scope concurrently and uses the
actual admission result. A temporary admission refusal queues work for retry when capacity
releases. A host or session allocation is current availability, not an
architecture or product limit. A dispatch wave is not pre-checked or budgeted
against a numeric limit. Cortex and Loom never encode, infer, or repeat a fixed
numeric agent or subagent concurrency cap.

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
  New feature and child branches follow the [branch naming contract](gizmo-prime/dynamic-skills/branch-naming.md).
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
