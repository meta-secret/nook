# PR Lifecycle Authorization Handshake

## Required packet

- **Controller:** owning Feature Gizmo.
- **Branch:** one canonical feature branch.
- **Base:** exact fresh `originMainSha`.
- **Target:** `main`.
- **Checks:** complete required PR check set.
- **Operation:** publish, open or update PR, observe checks, squash merge, or
  delete merged branch.

## Required actions

1. Verify the packet came through Gizmo Prime and Delivery Pipeline Team Gizmo.
2. Fetch and prune origin.
3. Resolve the canonical feature branch's latest committed head.
4. Reject a target other than `main`.
5. Perform only the named operation.
6. Return observed GitHub and Git evidence.

A branch advance invalidates older head-bound evidence. Follow the latest head
and rerun affected required checks.

## Prohibited actions

- Do not accept caller-selected checkout paths.
- Do not use a delivery `dev` branch.
- Do not infer authority for a different feature or operation.
- Do not bypass required checks.
- Do not make optional review or approval a gate.
