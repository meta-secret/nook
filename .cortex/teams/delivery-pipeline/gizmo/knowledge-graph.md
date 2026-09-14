# Delivery Pipeline Team Gizmo Knowledge Graph

Load only the authority needed to orchestrate the current delivery-pipeline
packet.

## Contract

- [Team Gizmo contract](AGENTS.md) defines parent reporting, decomposition,
  internal dispatch, exact-SHA handoffs, and escalation.
- [Activation prompt](activation-prompt.md) supplies the bounded invocation
  template.
- [Delivery Pipeline team contract](../AGENTS.md) defines the team's
  boundary and responsibility split.

## Delivery authorities

Prime supplies the applicable delivery authority in the packet.

## Internal children

- Dev Manager preserves manager-only policy and performs the bounded
  manager-cycle mechanics named in its packet.
- [PR Lifecycle Agent](../pr-lifecycle/AGENTS.md) performs only the bounded
  PR and delivery-mechanics operation named in its packet.

## Escalation

- Functional ownership, feature acceptance, and mission decisions return to
  Gizmo Prime.
- Dev validation, readiness, promotion, and pull-request creation policy
  return to the [Dev Manager](../dev-manager/AGENTS.md).
