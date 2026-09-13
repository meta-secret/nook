# Delivery Pipeline Team Gizmo Knowledge Graph

Load only the authority needed to orchestrate the current delivery-pipeline
packet.

## Contract

- [Team Gizmo contract](AGENTS.md) defines parent reporting, decomposition,
  internal dispatch, exact-SHA handoffs, and escalation.
- [Delivery Pipeline team contract](../../AGENTS.md) defines the team's
  boundary and responsibility split.

## Delivery authorities

- [Gizmo Prime](../../../gizmo-prime/AGENTS.md) is the parent delivery owner.
- [Multiagent delivery architecture](../../../gizmo-prime/architecture/multiagent-delivery-diagrams.md)
  defines the levels and handoffs.
- [Dev delivery](../../../gizmo-prime/architecture/dev-delivery.md) defines
  detailed evidence and guarded-promotion policy.

## Internal children

- [Dev Manager](../dev-manager/AGENTS.md) preserves manager-only policy and
  performs the bounded manager-cycle mechanics named in its packet.
- [PR Lifecycle Agent](../pr-lifecycle/AGENTS.md) performs only the bounded
  PR and delivery-mechanics operation named in its packet.
- [PR Lifecycle knowledge graph](../pr-lifecycle/knowledge-graph.md) indexes
  its operation workflows.

## Escalation

- Functional ownership, feature acceptance, and mission decisions return to
  [Gizmo Prime](../../../gizmo-prime/AGENTS.md).
- Dev validation, readiness, promotion, and pull-request creation policy
  return to the [Dev Manager](../dev-manager/AGENTS.md).
