# Team-Oriented Development Workflow

## Purpose

Team-oriented delivery routes work to functional owners while keeping one
serialized integration sequence within each feature. Concurrent features have
separate Gizmos and worktrees. The
[dev delivery contract](../architecture/dev-delivery.md) owns stage boundaries.
Gizmo Prime is the mission/root coordinator. Each team reports through a Team
Gizmo, which decomposes only team mechanics, dispatches internal Team Agents
through the active harness, and returns synthesized branch and observed-head
evidence or blockers to Prime.

## Planning

Before planning, delegation, worktree creation, or edits, Gizmo Prime runs
`git fetch --prune origin`; a fetch failure fails closed. Delivery/Dev Manager
then synchronizes canonical local `main` to the fetched `origin/main` and
brings canonical local `dev` onto or including that main baseline under the
dev-delivery workflow. If either synchronization cannot be proved, the run
fails closed. Prime records `originMainSha` for the exact freshly fetched
`origin/main`. Only after both synchronizations, Prime resolves the latest
committed `refs/heads/dev^{commit}` and records that exact commit as
`pinnedLocalDevSha` for bootstrap evidence. `originMainSha` must be an ancestor
of `pinnedLocalDevSha`. Every new feature mission, feature branch, and worktree
must use that exact latest committed canonical local `dev` commit as its base.
A previously pinned or otherwise older local-dev SHA, `origin/dev`,
`origin/main`, or another alternate base is invalid. If equality with
post-synchronization `refs/heads/dev` cannot be proved, bootstrap fails closed.
The base is preserved after feature creation. The canonical branch name is the
workflow authority. Observed SHAs are run evidence only. Before remote
dispatch, review, or landing, PR Lifecycle re-fetches and resolves the latest
committed branch head. A branch advance follows the latest head and reruns
affected evidence. Team Gizmos and leaves consume the branch name and
bootstrap evidence, not a pinned feature head. Missing or unprovable
branch/bootstrap evidence fails closed.

1. Define the requested outcome.
2. Identify the team that owns each required change.
3. Split tasks only at real ownership or dependency boundaries.
4. Give each task one team identity, bounded file scope, and acceptance
   evidence.
5. Name acceptance command read, write, and output scopes.
6. Identify shared files and shared outputs that need one assigned writer.
7. Inventory and attribute existing dirty paths and hunks.
8. Block overlap with pre-existing user or foreign changes without an exact
   handoff or same-task attribution.

## Execution

1. Group dependency-ready tasks with disjoint explicit file scopes.
   - Require concurrency-safe acceptance command scopes.
2. Create one child worktree for every task in the group from the parent
   feature worktree's current commit.
3. Start every task in its issued child worktree.
4. Let each Team Agent implement and author meaningful tests.
   - Permit only scoped rustfmt and bounded inexpensive TS diagnostics locally.
5. Require every writer to commit its complete scoped iteration.
6. Verify each child commit and integrate it into the parent feature worktree.
7. Have Delivery Pipeline Team Gizmo route the canonical branch's remote
   build-only packet to PR Lifecycle Agent. PR Lifecycle re-fetches and
   resolves the latest committed head before dispatch.
8. Require each terminal handoff to enumerate all iteration commits.
   - Each entry names its SHA, outcome, evidence, and unresolved blockers.
9. Verify each commit's changed paths and evidence.
10. Co-validate the combined parent-branch state.
11. Start dependent tasks only after their provider commits are integrated.

Read-only Team Agents may run concurrently when their inspection cannot
interfere with writers.

A later implementation or repair iteration reads the last one or two commits
relevant to its allowed files and named interfaces. It inspects those diffs
before editing.

## Cross-team dependencies

A Team Agent reports foreign-team work to Gizmo. It does not implement the
foreign capability or create another worker.

Gizmo assigns the dependency to its functional owner. A dependent consumer
waits for its provider commit. Independent work may continue in parallel.

Provider and consumer tasks define separate focused evidence and one combined
interface check. Gizmo routes a combined compilation or typecheck failure to
the provider, consumer, or both. Disjoint repair scopes may run in parallel
when no dependency remains between them.

## Review and validation

- Route every finding to the team that owns the affected change.
- Give fixes fresh child worktrees from the current parent frontier and integrate
  accepted commits through the same parent sequence.
- Team Agents author tests for the manager's slow stage.
- Gizmo Prime requests Delivery Pipeline Team Gizmo's remote compilation packet
  and owns feature review dispositions.
- Delivery Pipeline Team Gizmo routes PR Lifecycle Agent's serialized local
  integration after feature acceptance.
- The manually run dev manager controls publication, invokes
  `dev:pr-manager` for PR creation/update, and owns slow evidence, readiness,
  and promotion.
- PR Lifecycle Agent observes the PR and performs only review, check, status,
  and promotion mechanics under a manager packet.

## Prohibited complexity

Do not create:

- a Team Agent lifecycle service, scheduler, or Git-state machinery; or
- deletion-report schemas.

## Completion

The technical result is ready when:

- each change has one functional owner;
- concurrent writers had disjoint explicit file scopes;
- dependency and overlapping-scope order was preserved;
- dirty paths and hunks were attributed before dispatch;
- no commit included unrelated pre-existing changes;
- acceptance commands were concurrency-safe or ran serially on a stable
  committed head;
- only one writer mutated each worktree's Git index at a time;
- every writer committed its complete scoped iteration;
- terminal handoffs enumerated every iteration SHA, outcome, evidence, and
  unresolved blockers;
- combined provider-consumer evidence passed;
- all accepted changes are already on the shared branch;
- remote compilation passed for the current canonical branch head; and
- the branch is ready for Gizmo's external delivery sequence.
