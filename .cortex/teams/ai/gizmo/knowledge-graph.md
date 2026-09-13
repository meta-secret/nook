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

Every AI packet carries `originMainSha` for the exact freshly fetched main,
`pinnedLocalDevSha` for the synchronized local-dev source, and `featureHeadSha`
for the exact canonical feature frontier. Require `originMainSha` ancestor of
`pinnedLocalDevSha` ancestor of `featureHeadSha`. Prime creates every feature
branch and worktree strictly from the exact `pinnedLocalDevSha`; no alternate
base is permitted. The existing canonical feature ref and detached
implementation HEAD must equal `featureHeadSha` exactly. Initial equality and
descendant reruns are valid. The Team Gizmo and both specialists consume all
three identities. Missing, mismatched, stale, or unprovable evidence fails
closed.
