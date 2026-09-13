# Team-Oriented Development Workflow

## Purpose

Team-oriented delivery routes work to functional owners while keeping one
serialized integration sequence within each feature. Concurrent features have
separate Gizmos and worktrees. The
[dev delivery contract](../architecture/dev-delivery.md) owns stage boundaries.
Gizmo Prime is the mission/root coordinator. Each team reports through a Team
Gizmo, which decomposes only team mechanics, dispatches internal Team Agents
through the active harness, and returns synthesized exact-SHA evidence or
blockers to Prime.

## Planning

Before planning, delegation, worktree creation, or edits, Gizmo Prime runs
`git fetch --prune origin`; a fetch failure fails closed. Delivery/Dev Manager
then synchronizes canonical local `main` to the fetched `origin/main` and
brings canonical local `dev` onto or including that main baseline under the
dev-delivery workflow. If local dev is not current with main, the run fails
closed. Prime records `originMainSha` for the exact fetched `origin/main` and
`pinnedLocalDevSha` for the exact synchronized local-dev SHA in the mission
packet and every child handoff. New feature work starts from
`pinnedLocalDevSha` unless the user explicitly selects another base and Prime
records that choice. Team Gizmos and leaves consume that pinned SHA and must
not use stale local refs or resolve or guess a base independently.

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
7. Push the stable feature head and have Delivery Pipeline Team Gizmo route
   the remote build-only packet to PR Lifecycle Agent.
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
- remote compilation passed for the feature SHA; and
- the branch is ready for Gizmo's external delivery sequence.
