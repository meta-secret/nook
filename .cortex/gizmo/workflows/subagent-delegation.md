# Team Agent Delegation

## Purpose

Gizmo assigns bounded work to Team Agents and owns the delivery sequence.

Delegation must stay simple. It must not create a second workflow engine around
the active harness.

## Rules

- Every Team Agent task has one team identity. A PR Steward task uses the
  separate `pr-steward` operational context and remains a child task of Gizmo
  for policy and authorization.
- Every task names its outcome, allowed files, forbidden files, and acceptance
  evidence.
- Internally establish every known task and dependency before dispatch.
- Validate scope, ownership, and dispatch order without printing the plan.
- Use the optional
  [delegation visualization](../../teams/ai/dynamic-skills/delegation-visualization/SKILL.md)
  only when requested or needed to explain a consequential dependency change.
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
- Gizmo owns branch sequencing, PR authorization, technical review
  dispositions, readiness and merge verdicts. PR Steward performs only the
  explicitly authorized external pull-request mechanics described in the
  [PR Steward lifecycle](../../teams/pr-steward/workflows/pull-request-lifecycle.md).

## Procedure

1. Identify the team that owns the requested change.
2. Discover every Team Agent task and dependency currently known.
3. Define each bounded task with explicit file scope and acceptance evidence.
   - Include the [GitHub execution boundary](../../AGENTS.md#github-execution-boundary)
     in every functional worker prompt.
   - Tell the worker to request missing PR evidence from Gizmo.
   - Explicitly prohibit direct `gh` queries, equivalent GitHub access, and
     PR monitoring, including read-only `gh pr view`.
4. Check that no other write-capable Team Agent is active.
5. Start the Team Agent through the active harness in the current checkout.
6. Let the Team Agent implement and run focused checks.
7. Request one terminal handoff with changed outcomes, evidence references,
   and unresolved blockers.
8. Ask for a commit when useful for delivery.
9. Verify that the result stays inside the declared scope.
10. Continue from the resulting shared-branch state.
11. Route corrections to the team that owns the affected change.

## Dependencies

A Team Agent stops at another team's boundary and reports the missing
dependency to Gizmo.

Gizmo then assigns a separate bounded task to the owning team. The current
writer finishes or stops before another writer begins.

Workers do not create other workers. They do not change task ownership or the
delivery sequence.

### PR information requests

1. The worker reports the known PR or run target to Gizmo.
   It names the missing evidence and dependent work.
2. Gizmo supplies an explicit operation packet to PR Steward.
   Only PR Steward queries GitHub or starts a monitoring subscription.
3. PR Steward returns bounded evidence or a blocker to Gizmo.
4. Gizmo forwards the result to the requesting worker.
   The worker continues independent in-scope work while waiting when possible.

Missing PR identity is part of the request, not permission for worker discovery.
An unavailable Steward remains a blocker for the dependent work.

### Later discovery

Record a newly discovered dependency internally before dispatch. Report it only
when it changes the expected outcome or requires a decision. Render a new plan
only when a visualization is warranted. Never claim it was known earlier.

## Failure handling

- If task scope or dependency validation fails, stop dispatch.
  Report the blocker.
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
- focused acceptance checks passed;
- workers requested missing PR evidence through Gizmo without direct GitHub
  access or monitoring; and
- Gizmo still owns every external delivery decision and authorization. Any PR
  Steward mutation stays inside the named packet.
