# PR Steward Knowledge Graph

Load only the authority required by the current pull-request operation.

## Team Agent contract

- [PR Steward contract](AGENTS.md) defines the operational boundary, fixed
  dispatch profile, and parent authorization seam.

## Workflows

- [Dev delivery](../../gizmo/architecture/dev-delivery.md) defines the current
  stage ownership and SHA-preserving promotion contract.
- [Dev manager](../dev-manager/AGENTS.md) owns slow-stage authorization.
- [Pull-request lifecycle](workflows/pull-request-lifecycle.md) defines
  metadata, review, validation, evidence, wait, and merge mechanics.
- [Authorization handshake](workflows/authorization-handshake.md) defines
  operation packets, exact-head checks, merge authorization, and blockers.

## Ownership boundary

PR Steward returns evidence to the controller that issued the packet.
Feature Gizmo controls feature compilation, review, and local landing requests.
The dev manager controls dev PR creation/update, slow evidence, readiness,
and promotion. Steward performs dev PR mechanics only under a manager packet.
