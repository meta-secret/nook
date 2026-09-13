# Delivery Pipeline Internal PR Lifecycle Knowledge Graph

Load only the authority required by the current pull-request operation.

## Internal Team Agent contract

- [PR Lifecycle Agent contract](AGENTS.md) defines the internal operational boundary,
  fixed dispatch profile, and parent authorization seam.

## Workflows

- [Dev delivery](../../../gizmo-prime/architecture/dev-delivery.md) defines the current
  stage ownership and SHA-preserving promotion contract.
- [Dev manager](../dev-manager/AGENTS.md) owns slow-stage authorization.
- [Pull-request lifecycle](workflows/pull-request-lifecycle.md) defines
  metadata, review, validation, evidence, wait, and merge mechanics.
- [Authorization handshake](workflows/authorization-handshake.md) defines
  operation packets, exact-head checks, merge authorization, and blockers.

## Ownership boundary

Delivery Pipeline Team Gizmo is the parent that issues the child packet and
receives the terminal handoff. The PR Lifecycle Agent returns evidence to that parent,
which forwards it to the controller that owns the policy.
Feature Gizmo controls feature compilation, review, and local landing requests.
The Dev Manager controls dev PR creation/update through `dev:pr-manager`, plus
slow evidence, readiness, and promotion. The PR Lifecycle Agent observes the resulting PR and
performs only manager-authorized review, check, and promotion mechanics.

The PR Lifecycle Agent never creates or updates a pull request, chooses functional
ownership, or decides readiness or promotion.
