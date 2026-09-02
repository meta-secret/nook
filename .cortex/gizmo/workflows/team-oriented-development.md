# Team-Oriented Development Workflow

## Purpose

Team-oriented delivery routes work to functional owners while keeping one
simple shared-branch sequence.

## Planning

1. Define the requested outcome.
2. Identify the team that owns each required change.
3. Split tasks only at real ownership or dependency boundaries.
4. Give each task one team identity, bounded file scope, and acceptance
   evidence.
5. Identify shared files that need one assigned writer.

## Execution

1. Confirm that no write-capable Team Agent is active.
2. Start the next writer in the current checkout.
3. Let the Team Agent implement and run required non-compiling formatters.
4. Ask for a complete scoped commit when a commit helps sequencing.
5. Verify the changed paths.
6. Continue directly from the resulting shared-branch state.
7. Push and dispatch the acceptance evidence remotely.
8. Start the next dependent writer only after the current writer finishes.

Read-only Team Agents may run concurrently when their inspection cannot
interfere with the writer.

## Cross-team dependencies

A Team Agent reports foreign-team work to Gizmo. It does not implement the
foreign capability or create another worker.

Gizmo assigns the dependency to its functional owner after the current writer
finishes or stops.

## Review and validation

- Route every finding to the team that owns the affected change.
- Keep fixes inside the same shared checkout and writer sequence.
- Team Agents run focused implementation checks.
- Gizmo runs shared pre-push and exact-head validation.
- Gizmo owns pushes, pull requests, review replies, readiness, and merge.

## Prohibited complexity

Do not create:

- Team Agent worktrees;
- parallel Team Agent lifecycle or Git-state machinery; or
- deletion-report schemas.

## Completion

The technical result is ready when:

- each change has one functional owner;
- only one writer ran at a time;
- all accepted changes are already on the shared branch;
- focused tests passed; and
- the branch is ready for Gizmo's external delivery sequence.
