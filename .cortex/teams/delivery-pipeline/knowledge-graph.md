# Delivery Pipeline Knowledge Graph

## Team authority

- [Delivery Pipeline contract](AGENTS.md)
- [Delivery Pipeline Team Gizmo](gizmo/AGENTS.md)
- [PR Lifecycle Agent](pr-lifecycle/AGENTS.md)

## Canonical delivery

- [Multiagent delivery diagrams](../../gizmo-prime/architecture/multiagent-delivery-diagrams.md)
- [Feature pull-request delivery](../../gizmo-prime/architecture/dev-delivery.md)
- [PR lifecycle workflow](pr-lifecycle/workflows/pull-request-lifecycle.md)
- [Authorization handshake](pr-lifecycle/workflows/authorization-handshake.md)

The owning Feature Gizmo carries the feature through implementation, required
PR checks, squash merge to `main`, and remote branch deletion. Delivery
Pipeline owns only the bounded GitHub mechanics.
