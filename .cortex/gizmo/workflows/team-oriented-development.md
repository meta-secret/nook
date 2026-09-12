# Team-Oriented Development Workflow

## Purpose

Team-oriented delivery routes work to functional owners while keeping one
serialized integration sequence within each feature. Concurrent features have
separate Gizmos and worktrees. The
[dev delivery contract](../architecture/dev-delivery.md) owns stage boundaries.

## Planning

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
7. Push the stable feature head and request remote build-only execution via Steward.
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
- Gizmo requests remote compilation and owns feature review dispositions.
- Gizmo authorizes Steward's serialized local integration after feature acceptance.
- The manually run dev manager controls publication, dev PR creation/update,
  slow evidence, readiness, and promotion.
- PR Steward performs these dev PR mechanics only under a manager packet.

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
