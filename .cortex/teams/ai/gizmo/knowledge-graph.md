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

Every AI packet carries `originMainSha` for the fetched main ancestry and
`pinnedLocalDevSha` for the synchronized local-dev source. The Team Gizmo and
both specialists use only `pinnedLocalDevSha` as their feature base. Missing,
mismatched, or stale bootstrap evidence fails closed.
