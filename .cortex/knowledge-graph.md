# Cortex Context Router

Use this file only to select one owning context. Do not preload linked graphs.

## Entry contract

- [Agent routing contract](AGENTS.md) defines universal loading, ownership,
  authoring, and delivery boundaries.
- Gizmo Prime is the first actor for each new user-originated repository task.
  Follow-ups retain their current Gizmo owner.
- Assigned workers use the owning team context in their bounded packet.
- Gizmo routes manually requested dev operations to the dev manager.

## Canonical tree

### Roles and worktrees

Gizmo Prime lives at `gizmo-prime/`. Its six and only six top-level teams are
`teams/ai/`, `teams/dev-core/`, `teams/security/`, `teams/sre/`,
`teams/web-dev/`, and `teams/delivery-pipeline/`. Each team has one `gizmo/`
that reports to Prime. Every Team Gizmo uses `gpt-5.6-sol` with `low` reasoning.
Each Team Gizmo requests Fast mode with `service_tier: fast`, which resolves as
`priority`. Each leaf Team Agent uses `gpt-5.6-luna` with `xhigh` reasoning. It
requests Fast mode with `service_tier: fast`, which resolves as `priority`. Each
leaf receives a separate issued child worktree. Each Team Gizmo owns one team
worktree. Prime reuses or creates a compatible Team Gizmo before dispatch. That
Team Gizmo reuses or dispatches bounded internal leaf Team Agents, each in an
issued child worktree, and integrates specialist commits into its feature
branch.

### Fresh-base bootstrap

Before planning, delegation, worktree creation, or edits, Gizmo Prime runs
`git fetch --prune origin`; a fetch failure fails closed. Delivery/Dev Manager
then synchronizes canonical local `main` to the fetched `origin/main` and
brings canonical local `dev` onto or including that main baseline under the
dev-delivery workflow. If either synchronization cannot be proved, the run
fails closed. Only after both synchronizations, Prime resolves the latest
committed `refs/heads/dev^{commit}`. It records that exact
post-synchronization commit as `pinnedLocalDevSha` for bootstrap evidence.
Every new feature mission, feature branch, and worktree must use that exact
latest committed canonical local `dev` commit as its base. A previously pinned
or otherwise older local-dev SHA, `origin/dev`, `origin/main`, or another
alternate base is invalid. If equality between `pinnedLocalDevSha` and the
post-synchronization `refs/heads/dev` cannot be proved, the run fails closed.
The base is preserved after feature creation. Prime authorizes the canonical
feature branch name, which is the workflow authority. Observed base and head
SHAs are evidence only, not required packet fields. Delivery re-fetches and
resolves the latest committed branch head before each remote dispatch, review,
or landing operation. If the branch advances, follow the latest head and rerun
affected evidence. Team Gizmos and leaves keep temporary branches private.

### Harness admission

Active harness admission is dynamic. Gizmo immediately attempts every
dependency-ready Team Gizmo with a disjoint scope concurrently and uses the
actual admission result. A temporary admission refusal queues work for retry when capacity
releases. A host or session allocation is current availability, not an
architecture or product limit. A dispatch wave is not pre-checked or budgeted
against a numeric limit. Cortex and Loom never encode, infer, or repeat a fixed
numeric agent or subagent concurrency cap.

### Specialist routing

Current specialist routing includes SRE (`teams/sre/provisioning/`,
`teams/sre/cloud-native/`, and `teams/sre/docker-cache-specialist/`), Development Core
(`teams/dev-core/rust-core-developer/` and
`teams/dev-core/rust-auth2-developer/`), and Delivery Pipeline
(`teams/delivery-pipeline/gizmo/`, `teams/delivery-pipeline/dev-manager/`, and
`teams/delivery-pipeline/pr-lifecycle/`).

## Owning contexts

- [Delivery Pipeline](teams/delivery-pipeline/knowledge-graph.md): operational
  delivery mechanics. Its owner graph routes Team Gizmo, Dev Manager, and PR
  Lifecycle authorities.
- [Gizmo Prime](gizmo-prime/knowledge-graph.md): planning, delegation, integration,
  feature review, feature acceptance, local landing requests, and Workbench.
  Its owner graph routes delivery architecture and branch naming.
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
