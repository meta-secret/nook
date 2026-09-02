# Team Agent Delegation

## Purpose

Gizmo assigns bounded work to Team Agents and owns the delivery sequence.

Delegation must stay simple. It must not create a second workflow engine around
the active harness.

## Rules

- Every Team Agent task has one team identity.
- Every task names its outcome, allowed files, forbidden files, and acceptance
  evidence.
- Before any Team Agent starts, Gizmo lists every task and dependency currently
  known in native harness dispatch order.
- The user-visible hierarchy comes only from the validated
  [delegation visualization](../../teams/ai/dynamic-skills/delegation-visualization/SKILL.md)
  `delegationVisualization.render` result.
- The visualization request is ephemeral presentation input.
- It is not admission, scheduling, persistence, or agent-lifecycle state.
- Gizmo never composes, edits, or infers the returned tree.
- Give the Team Agent only its team entry point and task-relevant Cortex.
- Use the active harness for Team Agent communication.
- Do not use another Codex task, thread, cloud task, or external agent as
  delegation transport.
- Do not create a worktree for a Team Agent.
- Write-capable Team Agents use the current checkout and current branch.
- Only one write-capable Team Agent runs at a time.
- Read-only Team Agents may run concurrently when they cannot interfere with a
  writer.
- A Team Agent may commit its complete scoped change when Gizmo requests it.
- Gizmo continues directly from that commit.
- Do not cherry-pick, merge, copy, replay, or synthesize a worker commit into a
  separate integration branch.
- Gizmo owns branch sequencing, pushes, pull requests, review coordination,
  validation, readiness, and merge.

## Procedure

1. Identify the team that owns the requested change.
2. Discover every Team Agent task and dependency currently known.
3. Define each bounded task with explicit file scope and acceptance evidence.
4. Check that no other write-capable Team Agent is active.
5. Build one `delegationVisualization.render` request for that known work.
   - Give every task one identifier, team, description, and dependency list.
   - Keep tasks in native harness dispatch order.
   - Name only earlier tasks as dependencies.
6. Send the strict JSON request to the dependency-free static renderer on
   standard input through `task loom:delegation-visualization`. Never put the
   request in a shell argument or environment variable.
7. Emit one normal `GIZMO:STATE` activity line for the plan visualization.
8. Publish the returned `tree` verbatim as one compact user-visible block
   immediately below that activity line.
9. Start the Team Agent through the active harness in the current checkout.
10. Let the Team Agent implement and run required non-compiling formatters.
11. Ask for a commit when a commit is useful for the delivery sequence.
12. Verify that the result stays inside the declared scope.
13. Continue from the resulting shared-branch state.
14. Gizmo runs `task loom:pre-push` as the sole local validation exception.
15. Gizmo pushes the coherent head and dispatches its acceptance evidence
    remotely.
16. Route any correction to the team that owns the affected change.

## Dependencies

A Team Agent stops at another team's boundary and reports the missing
dependency to Gizmo.

Gizmo then assigns a separate bounded task to the owning team. The current
writer finishes or stops before another writer begins.

Workers do not create other workers. They do not change task ownership or the
delivery sequence.

### Later discovery

A genuinely later dependency was not part of the initial known work. Gizmo
must not backfill that dependency into the initial visualization or claim it
was known earlier. Before its Team Agent starts, Gizmo renders a new request
for the newly known work through the same presentation gate.

## Failure handling

- If request validation or visualization publication fails, report the blocker.
  Do not dispatch a Team Agent.
- If a required Team Agent cannot start, report the blocker.
- If a Team Agent produces out-of-scope changes, reject those changes and route
  a corrected task.
- If the current checkout contains unexpected edits, stop before starting a
  writer and identify their owner.
- Do not add a parallel Team Agent lifecycle or Git-state protocol to recover
  from a failure.

## Validation

Before accepting Team Agent work, verify:

- the task used the correct team identity;
- only the declared files changed;
- no other writer ran concurrently;
- the shared branch contains the accepted result;
- required acceptance evidence ran remotely; and
- Gizmo still owns every external delivery action.
