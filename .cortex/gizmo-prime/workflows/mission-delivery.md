# Mission Delivery

Apply the
[self-improvement authority](../../teams/ai/dynamic-skills/self-improvement.md)
throughout the delivery cycle. Treat every other active task as read-only.

## Ownership boundaries

- Use the explicit parent feature/integration worktree.
- Create one child worktree per Team Agent task from the parent frontier.
- Preserve the bounded task/attempt identity.
- Require a committed handoff before parent integration.
- Keep parent-owned integration/PR policy with Gizmo Prime.
- Preserve dependency order across assigned work.
- Grant one commit turn at a time for shared integration state.
- Do not create Team Agent lifecycle service, scheduler, or Git-state
  machinery.
- Do not create a persistent Delivery Pipeline or PR Lifecycle Agent service,
  scheduler, or notification journal.

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
   When direct remote execution is needed, approved examples are
   `task remote TASK_NAME=web:build` and
   `task remote TASK_NAME=web:e2e`. Forward the requested selector directly;
   do not discover, validate, or preflight it locally. The terminal GitHub
   Actions outcome is the execution evidence.
10. Repair complete terminal failure waves until all required checks are green.
11. Re-fetch main and the feature head.
12. Update from a changed main frontier and rerun invalidated checks.
13. Squash-merge the PR.
14. Verify actual merged state and the squash result on `origin/main`.
15. Delete the remote feature branch.
16. Clean up private child worktrees and branches.

Reviews and approvals are optional. The owning Feature Gizmo may merge its own
pull request. Required checks and known defects remain blocking.
