# Team Agent Delegation

## Bootstrap

Prime fetches and prunes origin before delegation. It records exact
`origin/main` as `originMainSha` and creates the canonical feature branch
from that commit. Child worktrees start from the current parent frontier.

## Required actions

- Inventory active and idle compatible threads before spawning. Reuse an
  existing Team Gizmo or leaf through the harness follow-up operation when its
  team, model/reasoning, worktree/branch, and bounded scope match; create a new
  child only when no compatible thread can be reactivated or the scope would
  conflict.
- Before any implementation, test, or validation command, Prime must have an
  active-harness result for the owning Team Gizmo and the Team Gizmo must have
  an active-harness result for at least one bounded Team Agent. Record each
  started child identity and scope. If either child is missing, stop and report
  the dispatch blocker instead of continuing directly.
- Route every high-level packet through the owning Team Gizmo.
- Give each leaf one team identity, bounded scope, issued worktree, and named
  acceptance evidence.
- Attempt dependency-ready disjoint agents concurrently.
- Queue temporary admission refusals as backpressure.
- Require each writer to commit its complete scoped iteration.
- Verify each child commit before parent integration.
- Keep Team Gizmo and leaf branches private.
- Integrate child commits into the canonical feature branch.
- Return branch state and blockers to Prime.
- Route feature PR mechanics through Delivery Pipeline and PR Lifecycle.

## Prohibited actions

- Do not use a delivery `dev` branch as a base or integration target.
- Do not push private child branches.
- Do not invent a fixed concurrency cap.
- Do not let Team Agents execute GitHub lifecycle operations.
