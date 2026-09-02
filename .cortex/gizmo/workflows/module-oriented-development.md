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
- Every currently known module task belongs to one immutable Loom delegation
  plan before its Team Agent starts.

## Procedure

1. Identify the modules and their provider-consumer order.
2. Assign each implementation task to its functional owner.
3. Build and visualize the complete immutable delegation plan for the known
   module sequence.
4. Start the first write-capable Team Agent in the current checkout.
5. Let the Team Agent implement and run required non-compiling formatters.
6. Verify its scoped changes and request its complete commit.
7. Start the next dependent writer from that provider commit.
8. Repeat the formatter, scope, and commit handoff for each remaining writer.
9. After the coherent module sequence, Gizmo runs `task loom:pre-push`.
10. Gizmo pushes the coherent head.
11. Gizmo dispatches every applicable hosted evidence task for that exact head.

## Review and corrections

Route each finding to the team that owns the affected module. Corrections use
the same shared checkout and writer sequence.

Do not create a worktree or parallel lifecycle or Git-state machinery for
module delivery.

## Validation

Verify:

- provider changes precede dependent consumer changes;
- the immutable Loom plan contains every module task known before dispatch;
- every writer stayed inside its assigned module scope;
- only one writer ran at a time;
- workers ran no local product compilation or validation;
- the shared branch contains the complete result; and
- Gizmo completed pre-push hygiene and pushed the coherent head;
- applicable hosted evidence passed for the exact pushed head; and
- Gizmo owns pull-request, readiness, and merge actions.
