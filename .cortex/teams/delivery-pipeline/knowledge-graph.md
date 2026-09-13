# Delivery Pipeline Knowledge Graph

Load only the authority required by the current delivery-pipeline operation.

The Delivery Pipeline team reports to Gizmo Prime. It is an operational
delivery team, not a functional product-engineering team.

## Team contract

- [Delivery Pipeline contract](AGENTS.md) defines the team boundary,
  responsibility split, packets, handoffs, and delivery invariants.

## Internal graphs

- [Team Gizmo knowledge graph](internal/gizmo/knowledge-graph.md) indexes its
  internal authorities and escalation paths.
- [PR Steward knowledge graph](internal/pr-steward/knowledge-graph.md) indexes
  its authorization and lifecycle workflows.

## Parent and policy authorities

- [Gizmo Prime](../../gizmo/AGENTS.md) is the parent delivery owner.
- [Multiagent delivery architecture](../../gizmo/architecture/multiagent-delivery-diagrams.md)
  defines levels, ownership, and exact-SHA handoffs.
- [Dev delivery](../../gizmo/architecture/dev-delivery.md) defines detailed
  authorization and promotion rules.
- [Dev Manager](../dev-manager/AGENTS.md) owns dev validation, readiness,
  promotion, and `dev:pr-manager`.
