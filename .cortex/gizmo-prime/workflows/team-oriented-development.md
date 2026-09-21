# Team-Oriented Development

## Procedure

1. Fetch and prune origin.
2. Create the canonical feature branch from exact fresh `origin/main`.
3. Route each functional scope to the single Team Gizmo.
4. Dispatch bounded Team Agents in isolated child worktrees.
5. Integrate their verified commits into the feature branch.
6. Route the feature PR through Delivery Pipeline and PR Lifecycle.
7. Run all required PR checks.
8. Send complete terminal failures back to the owning teams.
9. Squash-merge the fully green feature PR into `main`.
10. Delete the remote feature branch.

The single Team Gizmo coordinates mechanics. The owning Feature Gizmo controls readiness
and may merge its own pull request. Missing review or approval is non-blocking.
