# Mission Delivery

Apply the
[self-improvement authority](../../teams/ai/dynamic-skills/self-improvement.md)
throughout the delivery cycle. Treat every other active task as read-only.

## Ownership boundaries

- Use the upstream [local feature workflow](../../../.meta-cortex/teams/delivery-team/agents/integration-agent/skills/local-feature/SKILL.md)
  for workspace setup, worker completion, branch integration, and cleanup.
- Keep Nook's functional ownership and product acceptance requirements with
  Team Gizmo.
- Keep GitHub PR policy separate and under Gizmo Prime's authorization.
- Do not create a persistent Delivery Pipeline or PR Lifecycle Agent service,
  scheduler, or notification journal.

## Outcome

A feature starts from freshly fetched `origin/main`, completes implementation
through bounded Team Agents, passes every required PR check, squash-merges into
`main`, and deletes its remote feature branch.

## Procedure

1. Read the circuit breaker and complete delivery diagrams.
2. Run `git fetch --prune origin`.
3. Select freshly fetched `origin/main` as the upstream local workflow's base.
4. Use one feature branch for the entire feature.
5. Let Team Gizmo coordinate workers and the integration agent.
6. Stop after validated local integration when the user requested local-only work.
7. For authorized publication, route GitHub mechanics through Delivery Pipeline
   and PR Lifecycle.
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
16. Confirm upstream local cleanup completed for finished worker branches.

Reviews and approvals are optional. The owning Feature Gizmo may merge its own
pull request. Required checks and known defects remain blocking.
