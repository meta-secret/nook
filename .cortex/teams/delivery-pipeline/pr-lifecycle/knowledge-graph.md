# Delivery Pipeline PR Lifecycle Knowledge Graph

Load only the authority required by the current pull-request operation.

## Team Agent contract

- [PR Lifecycle Agent contract](AGENTS.md) defines the internal operational boundary,
  fixed dispatch profile, and parent authorization seam.

## Workflows

Prime supplies the current delivery authority. Dev Manager owns slow-stage
authorization.
- [Pull-request lifecycle](workflows/pull-request-lifecycle.md) defines
  metadata, review, validation, evidence, wait, and merge mechanics.
- [Authorization handshake](workflows/authorization-handshake.md) defines
  operation packets, current-branch checks, merge authorization, and blockers.

## Ownership boundary

Delivery Pipeline Team Gizmo is the parent that issues the child packet and
receives the terminal handoff. The PR Lifecycle Agent returns evidence to that parent,
which forwards it to the controller that owns the policy.
Feature Gizmo controls feature compilation, review, and local landing requests.
The Dev Manager controls dev PR creation/update through `dev:pr-manager`, plus
slow evidence, readiness, and promotion. For feature delivery, Gizmo Prime
authorizes the canonical branch name; PR Lifecycle re-fetches and resolves its
latest committed head, pushes that ref, and invokes its remote task. It
performs manager-authorized review, check, and promotion mechanics for the dev
cycle. Observed feature SHAs remain run evidence only.

The PR Lifecycle Agent never pushes a temporary leaf branch, invokes a remote
task from a temporary checkout, creates or updates a pull request, chooses
functional ownership, or decides readiness or promotion.
