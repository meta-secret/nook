# Team-Oriented Development

## Purpose

Route each implementation change to the team that owns it while keeping one
simple shared-branch delivery sequence.

## Procedure

1. Identify the functional owner.
2. Define allowed files and acceptance evidence.
3. Name acceptance command read, write, and output scopes.
4. Inventory and attribute existing dirty paths and hunks.
5. Block unowned overlap with pre-existing user or foreign changes.
6. Group dependency-ready tasks with concurrency-safe scopes.
7. Create one child worktree per task from the parent feature worktree's
   current commit, then start each group in parallel.
8. Let every Team Agent implement and run safe focused checks.
9. Grant one commit turn at a time.
10. Require every writer to commit its complete scoped iteration.
11. Run deferred checks serially on the stable committed head.
12. Require each terminal handoff to enumerate all iteration commits.
    - Each entry names its SHA, outcome, evidence, and unresolved blockers.
13. Verify each child commit and integrate the accepted commits into the parent
    feature worktree.
14. Co-validate the combined parent-branch state.
15. Route review or validation fixes to the responsible team.
16. Let Gizmo complete external delivery.

## Rules

- Every task has one team identity.
- Writers may run in parallel only with disjoint explicit file scopes and no
  unresolved dependency.
- A worker mutates only its child worktree's Git index. Gizmo serializes parent
  integration commits.
- Read-only inspection may run concurrently when safe.
- Workers stay inside their assigned scope.
- Workers report cross-team dependencies to Gizmo.
- Later iterations read the last one or two relevant commits and diffs.
- Gizmo assigns one writer for shared files and shared command outputs.
- Functional workers do not push, open pull requests, resolve review threads,
  or merge. PR Steward performs those external mechanics only through an
  explicit Gizmo authorization packet.
- Do not add a Team Agent lifecycle service, scheduler, or Git-state machinery.

## Validation

- The owning team implemented the change.
- The accepted result is already on the shared branch.
- Focused tests cover the changed behavior.
- Concurrent writers had disjoint explicit file scopes.
- Dependencies and overlapping scopes were ordered.
- Dirty paths and hunks were attributed before dispatch.
- No commit included unrelated pre-existing changes.
- Acceptance commands were concurrency-safe or ran serially on a stable
  committed head.
- Every writer committed its complete scoped iteration.
- Every terminal handoff enumerated each iteration SHA, outcome, evidence, and
  unresolved blockers.
- Only one writer mutated the Git index or committed at a time.
- Provider-consumer evidence passed on the combined branch.
- Gizmo retains external delivery policy, authorization, and verdict
  ownership. PR Steward executes only the named mechanics.
