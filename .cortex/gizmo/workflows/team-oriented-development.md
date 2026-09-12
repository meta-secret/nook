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

1. Group dependency-ready tasks with disjoint explicit file scopes.
2. Start every task in the group in the current checkout.
3. Let each Team Agent implement and run focused checks.
4. Grant one commit turn at a time as writers finish.
5. Require every writer to commit its complete scoped iteration.
6. Verify each commit's changed paths and evidence.
7. Co-validate the combined shared-branch state.
8. Start dependent tasks only after their provider commits.

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
- Keep fixes inside the same shared checkout and commit-turn sequence.
- Team Agents run focused implementation checks.
- Gizmo runs or authorizes shared pre-push and exact-head validation.
- Gizmo owns PR policy, review dispositions, readiness and merge verdicts.
- PR Steward performs authorized pull-request metadata, review observation,
  validation, readiness-evidence, merge, and merge-verification mechanics.

## Prohibited complexity

Do not create:

- Team Agent worktrees;
- a Team Agent lifecycle service, scheduler, or Git-state machinery; or
- deletion-report schemas.

## Completion

The technical result is ready when:

- each change has one functional owner;
- concurrent writers had disjoint explicit file scopes;
- dependency and overlapping-scope order was preserved;
- only one writer staged or committed at a time;
- every writer committed its complete scoped iteration;
- combined provider-consumer evidence passed;
- all accepted changes are already on the shared branch;
- focused tests passed; and
- the branch is ready for Gizmo's external delivery sequence.
