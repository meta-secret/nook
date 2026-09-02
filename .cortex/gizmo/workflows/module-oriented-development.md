# Module-Oriented Development

## Purpose

Module-oriented delivery follows real provider and consumer boundaries without
creating a separate Git integration system.

## Rules

- Identify the functional owner for every changed module.
- Keep provider changes before dependent consumer changes.
- Use one bounded Team Agent task per real ownership boundary.
- Write-capable Team Agents run sequentially in the current checkout.
- A downstream Team Agent starts from the current shared-branch commit.
- A Team Agent may commit its complete scoped change when Gizmo requests it.
- Before another writer starts, the current writer must commit its scoped change.
- Gizmo continues from that commit without replaying it elsewhere.
- Read-only experts return evidence only. They do not mutate Git or delivery
  state.
- Shared files receive one explicitly assigned writer.

## Procedure

1. Identify the modules and their provider-consumer order.
2. Assign each implementation task to its functional owner.
3. Start the first write-capable Team Agent in the current checkout.
4. Verify its focused tests and scoped changes.
5. If another writer follows, require the current writer's scoped commit.
6. Start the next dependent writer from that provider commit.
7. Run shared validation after the coherent module sequence is complete.

## Review and corrections

Route each finding to the team that owns the affected module. Corrections use
the same shared checkout and writer sequence.

Do not create a worktree or parallel lifecycle or Git-state machinery for
module delivery.

## Validation

Verify:

- provider changes precede dependent consumer changes;
- every writer stayed inside its assigned module scope;
- only one writer ran at a time;
- focused module tests passed;
- the shared branch contains the complete result; and
- Gizmo owns push, pull-request, readiness, and merge actions.
