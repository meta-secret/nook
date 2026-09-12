# Publish and Validate Dev

## Scope

Use only in a manually started dev-manager task. The
[canonical architecture](../../../gizmo/architecture/dev-delivery.md) owns
snapshot selection, concurrency, and evidence semantics.

## Procedure

1. Confirm the prior published attempt has finished.
2. Select a committed local dev snapshot and authorize Steward's snapshot publication.
3. Record the published SHA and freeze remote dev.
4. Authorize PR Steward to update the dev-to-main PR and run full slow checks.
5. On failure, send the evidence to a feature Gizmo for repair.
   - Require remote compilation and local integration for that repair.
   - Publish a new snapshot only after the prior attempt finishes.
6. On success, pass the frozen SHA and complete evidence to promotion.

## Prohibited actions

- Do not run this operation from a feature Gizmo or worker.
- Do not publish a new remote dev head during active validation or promotion.
- Do not path-skip tests across coalesced changes.
- Do not create a custom polling loop or cancel an active slow batch.

## Evidence

Return the snapshot SHA, PR identity, run/attempt identities, results, and any
repair handoff. Do not describe pending checks as successful.
