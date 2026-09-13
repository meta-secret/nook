# Cortex Specialist Knowledge Graph

Load only the authority needed for the assigned Cortex packet.

## Parent contracts

- [Cortex Specialist contract](AGENTS.md)
- [AI Team Gizmo contract](../gizmo/AGENTS.md)
- [AI team contract](../AGENTS.md)
- [AI team knowledge graph](../knowledge-graph.md)
- [Gizmo Prime knowledge graph](../../../gizmo-prime/knowledge-graph.md)

## Specialist focus

- Cortex work is limited to the exact AI-owned documents and evidence named by the packet.
- The specialist follows AI authorities for Cortex structure, navigation, authoring, and consistency.
- Foreign-team implementation and routing remain with their owning teams.

## Delivery authority

- [Multiagent delivery architecture](../../../gizmo-prime/architecture/multiagent-delivery-diagrams.md)
- [Dev delivery](../../../gizmo-prime/architecture/dev-delivery.md)

The packet must include `originMainSha` and `pinnedLocalDevSha`. Use only the
pinned local-dev SHA as the feature source. Reject missing, mismatched, or
stale bootstrap evidence.
