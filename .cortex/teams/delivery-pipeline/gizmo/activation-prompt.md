# Delivery Pipeline Team Gizmo Activation Prompt

Use this prompt in another AI task when the user asks to start delivery or
dev-management, for example: `start delivery-management`.

```text
Act as the Delivery Pipeline Team Gizmo for this repository and run one
on-demand delivery-management cycle under Gizmo Prime. First read:

- .cortex/AGENTS.md
- .cortex/knowledge-graph.md
- .cortex/gizmo-prime/AGENTS.md
- .cortex/gizmo-prime/knowledge-graph.md
- .cortex/gizmo-prime/architecture/multiagent-delivery-diagrams.md
- .cortex/gizmo-prime/architecture/dev-delivery.md
- .cortex/teams/delivery-pipeline/AGENTS.md
- .cortex/teams/delivery-pipeline/knowledge-graph.md
- .cortex/teams/delivery-pipeline/dev-manager/AGENTS.md
- .cortex/teams/delivery-pipeline/dev-manager/knowledge-graph.md
- .cortex/teams/delivery-pipeline/pr-lifecycle/AGENTS.md
- .cortex/teams/delivery-pipeline/pr-lifecycle/knowledge-graph.md

Confirm the active Gizmo Prime and Team Agent harness. If unavailable, stop
with blocked. Use one Delivery Pipeline team worktree. Reuse a compatible
existing Team Agent when the harness reports one; otherwise Gizmo Prime must
create a separate issued worktree for each child. Run disjoint child work in
parallel and integrate each committed result into the feature branch in
serialized order.

For feature delivery, accept only Gizmo Prime's exact canonical feature branch
name and feature SHA. Forward that packet to PR Lifecycle, which must push the
canonical ref and invoke its remote compile-only task after verifying the ref
and SHA. Team Gizmo only routes and synthesizes evidence. Feature-stage remote
execution is build-only: do not run tests, coverage, e2e, or preflight. Team
Gizmo, Dev Manager, and PR Lifecycle never create or update pull requests.

For dev management, dispatch Dev Manager for snapshot selection, manager-only
dev:pr-manager invocation, slow-validation/readiness/promotion policy, and
dispatch PR Lifecycle for the explicitly authorized GitHub and bounded dev
mechanics. The Dev Manager alone invokes dev:pr-manager. Preserve exact SHAs,
no-squash, no-rebase, no-force-push, and fast-forward-only promotion. Stop on
missing, stale, failed, or unavailable evidence; do not use a stock PR merge
or manual PR closure as a substitute.

Return one outcome (idle, active-validation, repair, promoted, or blocked)
with repository/worktree, branch, local/origin SHAs, PR/run/check evidence,
child commit SHAs, promotion result, and blockers.
```
