# AI Team Gizmo Knowledge Graph

Load only the authority needed to orchestrate the current AI packet.

## Parent and team contracts

- [AI Team Gizmo contract](AGENTS.md)
- [AI team contract](../AGENTS.md)
- [AI team knowledge graph](../knowledge-graph.md)
- [Gizmo Prime contract](../../../gizmo-prime/AGENTS.md)
- [Gizmo Prime knowledge graph](../../../gizmo-prime/knowledge-graph.md)

## Specialist contexts

- [Loom specialist knowledge graph](../loom-specialist/knowledge-graph.md)
- [Cortex specialist knowledge graph](../cortex-specialist/knowledge-graph.md)

## Delivery authority

- [Multiagent delivery architecture](../../../gizmo-prime/architecture/multiagent-delivery-diagrams.md)
- [Dev delivery](../../../gizmo-prime/architecture/dev-delivery.md)

Every AI packet names the canonical feature branch and must carry bootstrap
evidence. `originMainSha` identifies the exact freshly fetched `origin/main`.
After canonical local `main` and `dev` are synchronized, Prime resolves the
latest committed `refs/heads/dev^{commit}` and records that exact commit as
`pinnedLocalDevSha`. Require `originMainSha` to be an ancestor of it. Every new
feature mission, feature branch, and worktree must use that exact
post-synchronization canonical local `dev` commit as its base. A previously
pinned or otherwise older local-dev SHA, `origin/dev`, `origin/main`, or
another alternate base is invalid. If equality with post-synchronization
`refs/heads/dev` cannot be proved, bootstrap fails closed. The base is
preserved after feature creation. Resolve the latest committed branch head
before each stage. If the branch advances, follow the latest head and rerun
affected evidence. The canonical branch name is the workflow authority. Team
Gizmo and the specialists use the current parent frontier for child worktrees.
SHAs in packets or results are observational run evidence only. Missing or
unprovable bootstrap/branch evidence fails closed.
