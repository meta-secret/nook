# Delivery Pipeline Team Gizmo Knowledge Graph

Load only the authority needed to orchestrate the current delivery-pipeline
packet.

## Contract

- [Team Gizmo contract](AGENTS.md) defines parent reporting, decomposition,
  internal dispatch, exact-SHA handoffs, and escalation.
- [Delivery Pipeline team contract](../../AGENTS.md) defines the team's
  boundary and responsibility split.

## Delivery authorities

- [Gizmo Prime](../../../../gizmo/AGENTS.md) is the parent delivery owner.
- [Multiagent delivery architecture](../../../../gizmo/architecture/multiagent-delivery-diagrams.md)
  defines the levels and handoffs.
- [Dev delivery](../../../../gizmo/architecture/dev-delivery.md) defines
  detailed evidence and guarded-promotion policy.

## Internal child

- [Internal PR Steward](../pr-steward/AGENTS.md) performs only the mechanical
  operation named in Team Gizmo's child packet.
- [PR Steward knowledge graph](../pr-steward/knowledge-graph.md) indexes its
  operation workflows.

## Escalation

- Functional ownership, feature acceptance, and mission decisions return to
  [Gizmo Prime](../../../../gizmo/AGENTS.md).
- Dev validation, readiness, promotion, and pull-request creation policy
  return to the [Dev Manager](../../../dev-manager/AGENTS.md).
