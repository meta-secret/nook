# Team-Oriented Development

## Purpose

Route each implementation change to the team that owns it while keeping one
simple shared-branch delivery sequence.

## Procedure

1. Identify the functional owner.
2. Define the allowed files and acceptance evidence.
3. Start one write-capable Team Agent in the current checkout.
4. Let the Team Agent implement and run focused checks.
5. Ask the Team Agent to commit when a commit helps the sequence.
6. Continue directly from that shared-branch state.
7. Route review or validation fixes to the responsible team.
8. Let Gizmo complete external delivery.

## Rules

- Every task has one team identity.
- Only one writer runs at a time.
- Read-only inspection may run concurrently when safe.
- Workers stay inside their assigned scope.
- Workers report cross-team dependencies to Gizmo.
- Gizmo assigns one writer for shared files.
- Workers do not push, open pull requests, resolve review threads, or merge.
- Do not create worker worktrees.
- Do not add parallel Team Agent lifecycle or Git-state machinery.

## Validation

- The owning team implemented the change.
- The accepted result is already on the shared branch.
- Focused tests cover the changed behavior.
- No concurrent writer touched the checkout.
- Gizmo retains external delivery ownership.
