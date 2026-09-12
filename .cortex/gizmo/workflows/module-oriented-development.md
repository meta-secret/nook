# Module-Oriented Development

## Purpose

Module-oriented delivery follows real provider and consumer boundaries without
creating a separate Git integration system.

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
  worktree through the guarded module integrator.
- Read-only experts return evidence only. They do not mutate Git or delivery
  state.
- Shared files receive one explicitly assigned writer.

## Procedure

1. Identify the modules and their provider-consumer order.
2. Assign each implementation task to its functional owner.
3. Define provider exports, consumer assumptions, and acceptance evidence.
4. Create one child worktree for each dependency-ready task from the parent
   feature worktree's current commit.
5. Run only concurrency-safe focused checks during the wave.
6. Verify each completed child commit and integrate it into the parent worktree.
7. Run deferred checks serially on the stable parent head.
8. Verify focused tests and scoped changes.
9. Start dependent consumers from the integrated provider commit.
10. Co-validate compilation, types, and behavior on the combined branch.
   - Use only locally permitted checks or hosted evidence.
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
- focused module tests passed;
- provider-consumer evidence passed on the combined branch;
- the parent feature worktree contains the complete result; and
- Gizmo owns push sequencing, pull-request authorization, readiness and merge
  verdicts. PR Steward performs the named pull-request mechanics after
  authorization.
