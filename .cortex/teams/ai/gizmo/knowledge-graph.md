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

Every AI packet names the canonical feature branch and may carry bootstrap
evidence: `originMainSha` for the exact freshly fetched main and
`pinnedLocalDevSha` for the synchronized local-dev feature base. Require
`originMainSha` to be an ancestor of `pinnedLocalDevSha`. Prime creates the
feature branch and worktree from that current committed base and preserves it.
Resolve the latest committed branch head before each stage. If the branch
advances, follow the latest head and rerun affected evidence. Team Gizmo and
the specialists use the current parent frontier for child worktrees. SHAs in
packets or results are observational run evidence only. Missing or unprovable
bootstrap/branch evidence fails closed.
