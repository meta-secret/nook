# Loom Specialist Knowledge Graph

Load only the authority needed for the assigned Loom packet.

## Parent contracts

- [Loom Specialist contract](AGENTS.md)
- [AI Team Gizmo contract](../gizmo/AGENTS.md)
- [AI team contract](../AGENTS.md)
- [AI team knowledge graph](../knowledge-graph.md)
- [Gizmo Prime knowledge graph](../../../gizmo-prime/knowledge-graph.md)

## Specialist focus

- Loom work is limited to the exact AI-owned files and evidence named by the packet.
- The specialist follows AI authorities for Loom workflows, runtime tooling, and deterministic enforcement.
- Foreign-team implementation remains with its owning team.

## Delivery authority

- [Multiagent delivery architecture](../../../gizmo-prime/architecture/multiagent-delivery-diagrams.md)
- [Dev delivery](../../../gizmo-prime/architecture/dev-delivery.md)

The packet must include `originMainSha`, `pinnedLocalDevSha`, and
`featureHeadSha`. Require `originMainSha` ancestor of `pinnedLocalDevSha`
ancestor of `featureHeadSha`. Use only the Prime-pinned local-dev SHA as the
feature source. The existing canonical feature ref and detached implementation
HEAD must equal `featureHeadSha` exactly. Initial equality and descendant
frontiers for reruns are valid. Reject missing, mismatched, stale, or
unprovable bootstrap evidence.
