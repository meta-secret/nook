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
- Run dependency-ready write-capable Team Agents in parallel when their
  explicit file scopes are disjoint.
- Order writers whose scopes overlap or whose tasks have a dependency edge.
- Read-only Team Agents may run concurrently when they cannot interfere with a
  writer.
- Only one Team Agent stages files or creates a commit at a time.
- Every writer commits its complete scoped iteration during its Gizmo-granted
  commit turn.
- Gizmo continues directly from those commits.
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
4. Build the next dependency-ready wave from tasks with disjoint file scopes.
5. Start that wave through the active harness in the current checkout.
6. Let each Team Agent implement and run focused checks.
7. Grant one commit turn at a time as writers finish.
   - The writer stages only its allowed files.
   - The writer commits its complete iteration.
   - Other writers do not stage or commit during that turn.
8. Request one terminal handoff from each writer.
   - Include the commit SHA, changed outcomes, evidence, and blockers.
9. Verify each commit stays inside its declared scope.
10. Co-validate the combined branch after all tasks in the wave commit.
11. Continue with the next dependency-ready wave.
12. Route corrections to the team that owns the affected change.

Before a later implementation or repair iteration, the Team Agent reads the
last one or two commits relevant to its allowed files and named interfaces. It
also inspects those diffs. This committed history supplements the task prompt.
It does not replace the explicit scope or acceptance evidence.

## Dependencies

A Team Agent stops at another team's boundary and reports the missing
dependency to Gizmo.

Gizmo assigns a separate bounded task to the owning team. A dependent consumer
waits for the provider commit. Independent work may remain in the active wave.

For a cross-team provider-consumer boundary, Gizmo records:

- the provider-owned interface and its observable acceptance evidence;
- the consumer assumption and its observable acceptance evidence; and
- the combined compilation, typecheck, or behavior evidence.

Provider and consumer tasks may run in parallel when both can implement against
an already agreed interface. If the consumer needs the provider's new output,
the provider task is an explicit dependency.

After both commits exist, Gizmo co-validates the combined branch. A failure is
routed to the provider when the exported contract is wrong. It is routed to the
consumer when the contract is used incorrectly. When both sides must change,
Gizmo assigns both bounded repair tasks. Those repairs may run in parallel only
when their scopes remain disjoint and neither repair depends on the other.

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
- If the checkout contains edits outside the declared active scopes, stop the
  affected dispatch and identify their owner.
- Do not add a lifecycle service or Git-state protocol to recover from a
  failure.

## Validation

Before accepting Team Agent work, verify:

- the task used the correct team identity;
- only the declared files changed;
- concurrent writers had disjoint explicit file scopes;
- dependency edges and overlapping scopes were ordered;
- only one writer staged or committed at a time;
- the shared branch contains the accepted result;
- every writer committed its complete scoped iteration;
- later iterations inspected the last one or two relevant commits and diffs;
- provider-consumer evidence passed on the combined branch;
- focused acceptance checks passed;
- workers requested missing PR evidence through Gizmo without direct GitHub
  access or monitoring; and
- Gizmo still owns every external delivery decision and authorization. Any PR
  Steward mutation stays inside the named packet.
