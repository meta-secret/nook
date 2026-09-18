# Nook Cortex Knowledge Graph

## Required entry

Read [the circuit breaker](CIRCUIT-BREAKER.md), then
[the root routing contract](AGENTS.md).

Every repository implementation and delivery mission starts under
[Gizmo Prime](gizmo-prime/AGENTS.md). Read the complete
[multiagent delivery diagrams](gizmo-prime/architecture/multiagent-delivery-diagrams.md)
before acting.

## Delivery

- [Feature pull-request delivery](gizmo-prime/architecture/dev-delivery.md)
- [Branch naming](gizmo-prime/dynamic-skills/branch-naming.md)
- [Mission delivery](gizmo-prime/workflows/mission-delivery.md)
- [Pull requests](gizmo-prime/workflows/pull-requests.md)
- [Team ownership](gizmo-prime/architecture/team-ownership.md)

Every feature starts from freshly fetched `origin/main`. The owning Feature
Gizmo carries the full cycle through all required PR checks, squash merge to
`main`, actual merged-state verification, and remote feature-branch deletion.
Reviews and approvals are optional.

## Owning contexts

- [AI](teams/ai/knowledge-graph.md)
- [Development Core](teams/dev-core/knowledge-graph.md)
- [Security](teams/security/knowledge-graph.md)
- [SRE](teams/sre/knowledge-graph.md)
- [Web Development](teams/web-dev/knowledge-graph.md)
- [Delivery Pipeline](teams/delivery-pipeline/knowledge-graph.md)

Delivery Pipeline routes bounded GitHub mechanics to PR Lifecycle Agent. There
is no Feature Gizmo authority or delivery `dev` branch.
