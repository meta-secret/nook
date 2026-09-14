# Module-Oriented Development

## Purpose

Module-oriented delivery follows real provider and consumer boundaries without
creating a separate Git integration system.
Gizmo Prime is the mission/root coordinator. Each team reports through a Team
Gizmo; Team Gizmo decomposes only that team's mechanics, dispatches internal
Team Agents through the active harness, and reports branch and observed-head
evidence or blockers back to Prime. It is not a second Prime and does not decide functional
ownership, readiness, promotion, or final delivery.

## Rules

- Identify the functional owner for every changed module.
- Keep provider changes before consumers that require the provider's new
  output.
- Use one bounded Team Agent task per real ownership boundary.
- Independent writers with disjoint explicit file scopes may run in parallel in
  isolated child worktrees from the same parent frontier.
- Acceptance commands must have concurrency-safe read, write, and output
  scopes.
- Shared generated or output paths receive one assigned writer.
- A provider and consumer may run in parallel when both implement an already
  agreed interface.
- A dependent consumer starts from the parent feature worktree after the
  provider commit is integrated.
- Every writer commits its complete scoped iteration during a serialized commit
  turn.
- Gizmo verifies those commits and integrates them into the parent feature
  worktree through ordinary Git under the
  [child integration rules](subagent-delegation.md).
  Gizmo serializes mutations of the parent index.
  Shared local dev landing remains the separate authorized `dev:land` operation.
- Read-only experts return evidence only. They do not mutate Git or delivery
  state.
- Shared files receive one explicitly assigned writer.
- Do not run local tests, including Loom tests, or local product compilation,
  Docker, coverage, e2e, or preflight. Local validation is limited to scoped
  rustfmt and bounded inexpensive TypeScript diagnostics or formatting.
- Author meaningful behavior tests for the dev-manager slow PR stage. Feature
  validation uses repeatable remote `build:compile` evidence only; compilation
  does not replace security review or authored tests.

## Procedure

Before this procedure, Gizmo Prime runs `git fetch --prune origin`; a fetch
failure fails closed. Delivery/Dev Manager synchronizes canonical local `main`
to the fetched `origin/main` and brings canonical local `dev` onto or including
that main baseline under the dev-delivery workflow. If local dev is not current
with main, the run fails closed. Prime records `originMainSha` for the exact
fetched `origin/main` and `pinnedLocalDevSha` for the exact synchronized
local-dev SHA. Prime may record an observed `featureHeadSha` as run association
only; it is not branch authority. Require `originMainSha` to be an ancestor of
`pinnedLocalDevSha`, and preserve that bootstrap/base evidence. Prime creates
every new feature branch and worktree strictly from the exact
`pinnedLocalDevSha`; no alternate base is permitted. The canonical feature
branch name is the workflow authority. Before remote dispatch, review, or
landing, PR Lifecycle re-fetches and resolves the latest committed branch
head; a branch advance follows the latest head and reruns affected evidence.
Team Gizmos and leaves consume the branch name and bootstrap evidence, not a
pinned feature head. Missing or unprovable branch/bootstrap evidence fails
closed.

1. Identify the modules and their provider-consumer order.
2. Assign each implementation task to its functional owner.
3. Define provider exports, consumer assumptions, and acceptance evidence.
4. Create one child worktree for each dependency-ready task from the parent
   feature worktree's current commit.
5. Use only the permitted lightweight local diagnostics during the wave.
6. Verify each completed child commit and integrate it into the parent worktree.
7. Push the feature branch and have Delivery Pipeline Team Gizmo route a
   remote build-only compilation packet for the latest committed canonical
   branch head; PR Lifecycle re-fetches and resolves that head before dispatch.
   Do not run feature tests or slow PR checks.
8. Review authored focused tests and scoped changes without executing tests.
9. Start dependent consumers from the integrated provider commit.
10. Obtain remote compilation and type evidence on the combined canonical
    branch head; record its observed SHA as run evidence only.
    Gizmo Prime authorizes Delivery Pipeline Team Gizmo's bounded `dev:land`
    packet for serialized local dev integration; Gizmo does not publish dev.
11. Route failures to the responsible provider, consumer, or both.

## Review and corrections

Route each finding to the team that owns the affected module. Corrections use a
fresh child worktree from the current parent frontier. Disjoint,
dependency-ready repairs may run in parallel and integrate through serialized
parent turns.

Do not create a Team Agent lifecycle service, scheduler, or Git-state machinery
for module delivery.

## Validation

Verify:

- provider changes preceded dependent consumer changes;
- parallel writers had disjoint explicit file scopes;
- every writer stayed inside its assigned module scope;
- acceptance commands were concurrency-safe or ran serially on a stable
  committed head;
- only one writer mutated the Git index or committed at a time;
- every writer committed its complete scoped iteration;
- meaningful module tests were authored for the slow stage;
- current-branch-head remote build-only provider-consumer evidence passed;
- the parent feature worktree contains the complete result; and
  - Gizmo Prime owns feature push sequencing, review, acceptance, and local
    landing requests. Delivery Pipeline Team Gizmo routes PR Lifecycle Agent
    mechanics. The manually operated dev manager owns dev publication, dev PR
    creation/update, slow evidence, readiness, and fast-forward promotion. The
    manager invokes `dev:pr-manager`; PR Lifecycle Agent observes the
    resulting PR and performs review, check, and promotion mechanics only under
    the manager's bounded packet, as defined by the [dev delivery contract](../architecture/dev-delivery.md).
