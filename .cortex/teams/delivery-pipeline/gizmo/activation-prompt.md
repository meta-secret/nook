# Delivery Pipeline Team Gizmo Activation

Read the root circuit breaker and complete multiagent delivery diagrams first.
Accept only a Gizmo Prime packet.

Preserve the canonical feature branch and fresh `originMainSha`. Dispatch PR
Lifecycle Agent for branch publication, feature PR creation or update, complete
required-check observation, squash merge, actual merged-state verification,
and remote feature-branch deletion.

The owning Feature Gizmo carries the full feature cycle. It may merge its own
pull request. Missing reviews or approvals do not block delivery. Required
checks, known correctness defects, and security findings still block merge.

Do not create a Feature Gizmo, use a delivery `dev` branch, invoke retired
`dev:*` commands, bypass required checks, or create merge commits on `main`.
