# Team Agent Delegation

## Purpose

Gizmo Prime assigns high-level team packets and owns the mission delivery
sequence. Each Team Gizmo assigns bounded internal work within its team's
packet and reports the synthesized result upward.

Delegation must stay simple. It must not create a second workflow engine around
the active harness.

## Mandatory fail-closed invocation gate

Every implementation or delivery run must start through Gizmo Prime. Gizmo
Prime must invoke the active Gizmo harness and issue the high-level packet to
the owning Team Gizmo; that Team Gizmo dispatches bounded internal Team Agents
before any implementation, repair, review, validation, GitHub, landing, dev
validation, or promotion work begins. This dispatch requirement is mandatory;
disjoint scopes or a small task never authorize direct execution by the root.

If Gizmo Prime, a required Team Gizmo, or the Team Agent harness cannot be
invoked or started, the run is failed and stops immediately. No
implementation, validation, GitHub, or landing work may continue. A non-Gizmo
root must not execute the work directly, and another Codex task, thread, cloud
task, or external agent is not a fallback or a substitute for the
Prime-to-Team-Gizmo dispatch chain.

## Rules

- Follow [dev delivery](../architecture/dev-delivery.md) for stage boundaries.
- Gizmo Prime must complete the fresh-base bootstrap before planning,
  delegation, worktree creation, or edits: run `git fetch --prune origin` and
  fail closed on failure.
  Delivery/Dev Manager synchronizes canonical local `main` to the fetched
  `origin/main`, then brings canonical local `dev` onto or including that main
  baseline under the dev-delivery workflow; stale local dev fails closed.
  Prime records `originMainSha` for the exact freshly fetched main and
  `pinnedLocalDevSha` for the exact synchronized local-dev SHA. An observed
  `featureHeadSha` is run association only, not branch authority. Require
  `originMainSha` to be an ancestor of `pinnedLocalDevSha`; preserve that
  bootstrap/base evidence. Prime creates every new feature branch and worktree
  strictly from the exact `pinnedLocalDevSha`; no alternate base is permitted.
  The canonical branch name is the workflow authority. Before remote dispatch,
  review, or landing, PR Lifecycle re-fetches and resolves the latest committed
  branch head; a branch advance follows the latest head and reruns affected
  evidence. Team Gizmos and leaves consume the branch name and bootstrap
  evidence, not a pinned feature head. Missing or unprovable branch/bootstrap
  evidence fails closed.
- Apply the [branch naming contract](../dynamic-skills/branch-naming.md) to
  every new Prime, Team Gizmo, and leaf branch.
- Author tests without executing them in the feature stage.
- Local feedback is limited to scoped rustfmt and bounded TS diagnostics.
- Delivery Pipeline Team Gizmo requests remote build-only execution through
  its PR Lifecycle Agent.
- Every Team Agent task has one team identity. An PR Lifecycle Agent task
  uses the Delivery Pipeline operational context and remains a child task of
  Team Gizmo for policy and authorization.
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
- Create exactly one child worktree for each Team Agent from the parent feature
  worktree's current committed frontier.
- Pass the Prime-authorized canonical branch name and bootstrap evidence through
  every child packet and handoff: `originMainSha` and `pinnedLocalDevSha`.
  An observed feature-head SHA may accompany a handoff as run evidence only.
- Preserve the ordered bootstrap ancestry and branch authority in every child
  handoff. Before each remote, review, or landing operation, re-resolve the
  latest committed head; do not promote an observed SHA to authority or resolve
  a base independently.
- Bind the child path and branch to the task and attempt identity.
- The child worktree must be disjoint from the parent and every other active
  child worktree.
- Workers must not create child worktrees or choose a different child path.
- Run dependency-ready write-capable Team Agents in parallel when their
  explicit file scopes are disjoint.
- Immediately attempt every dependency-ready Team Gizmo with a disjoint scope
  concurrently and use the active harness's actual admission result.
- If admission is temporarily refused, queue the task as backpressure and retry
  it when capacity releases.
- Treat host or session allocation as current availability, not an architecture
  or product limit.
- Do not pre-check or budget a dispatch wave against a numeric limit.
- Never encode, infer, or repeat a fixed numeric agent or subagent concurrency
  cap.
- Order writers whose scopes overlap or whose tasks have a dependency edge.
- Inventory and attribute dirty paths and hunks before dispatch.
- Block a proposed scope that overlaps pre-existing user or foreign changes.
  - Dispatch may proceed only when those exact changes are handed off or
    attributed to the proposed task.
- Name each acceptance command's read, write, and output scopes.
- Run acceptance commands concurrently only when their scopes are safe.
  - A command must not read a peer scope while that scope may change.
  - Its write and output scopes must not overlap a peer task or command scope.
  - A shared generated or output path is a shared file with one writer.
  - A command with uncertain or conflicting scope waits for a stable committed
    head and runs serially.
- Read-only Team Agents may run concurrently when they cannot interfere with a
  writer.
- Each worker mutates only its own child worktree's Git index. Gizmo serializes
  parent integration commits.
- Every writer commits its complete scoped iteration during its Gizmo-granted
  commit turn.
- Team Gizmo verifies that each child delta is non-empty before integration.
- A no-op child returns evidence and is cleaned up without a commit.
- Gizmo verifies each child commit and integrates it into the parent feature
  worktree through ordinary Git under the integration rules below.
  Gizmo serializes mutations of the parent index.
  Shared local dev landing remains the separate authorized `dev:land` operation.
- Prefer `git merge --ff-only` when the feature frontier has not moved.
- Otherwise cherry-pick only non-empty leaf commits without merge commits.
- After verified integration, remove the child worktree and delete its local
  child branch.
- Do not copy, replay, or synthesize a worker commit into an unrelated branch.
- Gizmo Prime owns feature sequencing, review, acceptance, and landing
  requests. Team Gizmo owns only its team's mechanics and evidence synthesis.
  The dev manager controls dev PR creation/update through `dev:pr-manager`,
  slow evidence, readiness, and promotion. PR Lifecycle Agent observes the
  PR and performs only review, check, status, and promotion mechanics under
  manager packets.
  Follow the
  [PR Lifecycle Agent lifecycle](../../teams/delivery-pipeline/pr-lifecycle/workflows/pull-request-lifecycle.md).

## Procedure

1. Identify the team that owns the requested change and its Team Gizmo.
2. Discover every Team Agent task and dependency currently known.
3. Have Gizmo Prime issue the high-level packet through the active harness.
4. Define each bounded internal task with explicit file scope and acceptance
   evidence.
   - Name every acceptance command's read, write, and output scopes.
   - Include the [GitHub execution boundary](../../AGENTS.md#github-execution-boundary)
     in every functional worker prompt.
   - Tell the worker to request missing branch, run, or manager-owned PR
     evidence from Gizmo.
   - Explicitly prohibit direct `gh` queries, equivalent GitHub access, and
     PR monitoring, including read-only `gh pr view`.
5. Inspect the current dirty paths and diff hunks.
6. Attribute every dirty change to its owner and task.
   - If a proposed scope overlaps a pre-existing user or foreign change, block
     that task.
   - Proceed only after an exact handoff or same-task attribution.
7. Build the next dependency-ready wave.
   - Require disjoint file scopes.
   - Require concurrency-safe acceptance command scopes.
   - Treat shared generated and output paths as shared files.
   - Defer unsafe checks until the relevant changes are committed.
8. Create one child worktree per task from the parent feature worktree's current
   commit.
9. Start that wave through the active harness with each worker in its issued
   child worktree.
10. Let each Team Agent implement and author behavior-focused tests.
11. Require each worker to commit its complete iteration in its child worktree.
    - The worker stages only its allowed files.
    - The commit must be directly after the child baseline.
12. Verify each child commit and have Team Gizmo return it to Gizmo Prime for
    serialized integration into the parent feature worktree
    in a serialized integration turn.
13. Request remote compilation after the parent has a stable committed head.
    - Route any tracked output to its assigned owner.
    - Require that owner to commit the output as a complete new iteration.
14. Request one terminal handoff from each writer.
    - Enumerate every committed iteration in order.
    - For each iteration, include its SHA, outcome, evidence, and unresolved
      blockers.
15. Verify each commit stays inside its declared scope.
16. Co-validate the combined parent branch after all tasks in the wave commit.
17. Continue with the next dependency-ready wave from the parent frontier.
18. Route corrections to the team that owns the affected change.

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

1. The worker reports the known branch, run, or manager-owned PR target to its
   Team Gizmo, which escalates the missing evidence and dependent work to
   Gizmo Prime.
2. Delivery Pipeline Team Gizmo supplies an explicit operation packet to
   PR Lifecycle Agent. Only PR Lifecycle Agent queries GitHub or starts a
   monitoring subscription.
3. PR Lifecycle Agent returns bounded evidence or a blocker to Delivery
   Pipeline Team Gizmo.
4. Team Gizmo synthesizes the result, reports it to Gizmo Prime, and forwards
   the result to the requesting worker.
   The worker continues independent in-scope work while waiting when possible.

Missing PR identity is part of the request, not permission for worker discovery.
An unavailable PR Lifecycle Agent remains a blocker for the dependent work.

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
- If a proposed scope overlaps pre-existing user or foreign changes without an
  exact handoff or same-task attribution, block that dispatch.
- If a child or parent worktree contains edits outside the declared active
  scopes, stop the affected dispatch and identify their owner.
- Do not add a lifecycle service or Git-state protocol to recover from a
  failure.

## Validation

Before accepting Team Agent work, verify:

- the task used the correct team identity;
- only the declared files changed;
- concurrent writers had disjoint explicit file scopes;
- dependency edges and overlapping scopes were ordered;
- dirty paths and hunks were attributed before dispatch;
- no commit included unrelated pre-existing changes;
- acceptance command read, write, and output scopes were concurrency-safe;
- unsafe checks ran serially on a stable committed head;
- only one writer mutated each worktree's Git index at a time;
- the parent feature worktree contains every accepted result;
- every child worktree was created from the recorded parent frontier;
- each child worktree was clean after its handoff and was cleaned up only after
  integration;
- parent integration was serialized;
- every writer committed its complete scoped iteration;
- each terminal handoff enumerated every iteration commit in order;
- each iteration entry named its SHA, outcome, evidence, and unresolved
  blockers;
- later iterations inspected the last one or two relevant commits and diffs;
- provider-consumer evidence passed on the combined branch;
- remote build-only acceptance passed for the current canonical branch head;
- workers requested missing PR evidence through Gizmo without direct GitHub
  access or monitoring; and
- Gizmo owns feature-stage decisions and landing authorization.
- The dev manager controls dev PR operations, readiness, and promotion.
- PR Lifecycle Agent mutations stay inside the owning controller's packet.
