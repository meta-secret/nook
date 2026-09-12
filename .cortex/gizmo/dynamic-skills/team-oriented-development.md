# Team-Oriented Development

## Purpose

Route each implementation change to the team that owns it while keeping one
simple shared-branch delivery sequence.

## Procedure

1. Identify the functional owner.
2. Define the allowed files and acceptance evidence.
3. Group dependency-ready tasks with disjoint explicit file scopes.
4. Start each group in parallel in the current checkout.
5. Let every Team Agent implement and run focused checks.
6. Grant one commit turn at a time.
7. Require every writer to commit its complete scoped iteration.
8. Co-validate the combined shared-branch state.
9. Route review or validation fixes to the responsible team.
10. Let Gizmo complete external delivery.

## Rules

- Every task has one team identity.
- Writers may run in parallel only with disjoint explicit file scopes and no
  unresolved dependency.
- Only one writer stages or commits at a time.
- Read-only inspection may run concurrently when safe.
- Workers stay inside their assigned scope.
- Workers report cross-team dependencies to Gizmo.
- Later iterations read the last one or two relevant commits and diffs.
- Gizmo assigns one writer for shared files.
- Functional workers do not push, open pull requests, resolve review threads,
  or merge. PR Steward performs those external mechanics only through an
  explicit Gizmo authorization packet.
- Do not create worker worktrees.
- Do not add a Team Agent lifecycle service, scheduler, or Git-state machinery.

## Validation

- The owning team implemented the change.
- The accepted result is already on the shared branch.
- Focused tests cover the changed behavior.
- Concurrent writers had disjoint explicit file scopes.
- Dependencies and overlapping scopes were ordered.
- Every writer committed its complete scoped iteration.
- Only one writer staged or committed at a time.
- Provider-consumer evidence passed on the combined branch.
- Gizmo retains external delivery policy, authorization, and verdict
  ownership. PR Steward executes only the named mechanics.
