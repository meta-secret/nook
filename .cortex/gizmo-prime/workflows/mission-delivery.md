# Mission Delivery

## Outcome

A feature starts from freshly fetched `origin/main`, completes implementation
through bounded Team Agents, passes every required PR check, squash-merges into
`main`, and deletes its remote feature branch.

## Procedure

1. Read the circuit breaker and complete delivery diagrams.
2. Run `git fetch --prune origin`.
3. Resolve exact `origin/main` as `originMainSha`.
4. Create the canonical feature branch and worktree from that commit.
5. Dispatch bounded team packets through Team Gizmos.
6. Integrate reviewed child commits into the feature branch.
7. Route GitHub mechanics through Delivery Pipeline and PR Lifecycle.
8. Push the feature branch and create or update one PR into `main`.
9. Run every required PR check for the current head.
10. Repair complete terminal failure waves until all required checks are green.
11. Re-fetch main and the feature head.
12. Update from a changed main frontier and rerun invalidated checks.
13. Squash-merge the PR.
14. Verify actual merged state and the squash result on `origin/main`.
15. Delete the remote feature branch.
16. Clean up private child worktrees and branches.

Reviews and approvals are optional. The owning Feature Gizmo may merge its own
pull request. Required checks and known defects remain blocking.
