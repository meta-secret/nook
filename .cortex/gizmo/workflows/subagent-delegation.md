# Subagent Delegation

## Overview

- Use this workflow when different subagents can complete separate tasks.
- Keep Gizmo as the delivery owner.
- Team subagents implement their assigned tasks. They do not control delivery.

## Decision rule

A capable agent environment MUST delegate when all of these conditions hold:

1. The request contains at least two separate team tasks.
2. Each selected ready task can receive an exact starting frontier.
3. Concurrent write tasks have isolated workspaces and disjoint resource claims.
4. Each subagent has explicit inputs and expected outputs.
5. Each subagent has its own acceptance evidence.
6. Gizmo can state how the returned results will be integrated before work
   starts.

- Use an exact Git commit as each task's immutable starting frontier.
  - Do not use a movable branch name as a worker baseline.
- Do not require one common baseline for the whole mission.
- Record the delegation decision in the task plan.
- Let the active harness own same-model inheritance and any explicit selection.
- Do not encode model selection in the repository task contract.
- If the host cannot start the required subagents:
  - report an implementation blocker;
  - do not let Gizmo implement the assigned task; and
  - do not invent an undocumented subagent runner.

## Deterministic work belongs to tools

Simple does not mean agent-shaped.

Use Loom, Task, or another deterministic tool when the output follows entirely
from declared inputs.

Examples include:

- formatting;
- Cortex link and index checks;
- dependency popularity thresholds;
- test and build commands;
- PR status and readiness queries;
- agent-statistics assembly and publication.

Subagents are for bounded semantic judgment or isolated implementation.

Deterministic orchestration does not make model output deterministic.

It makes these properties deterministic:

- reachability;
- dependency order;
- concurrency eligibility;
- worker count;
- retry policy;
- result shape;
- lifecycle state.

## Gizmo

Exactly one Gizmo owns delivery.

Gizmo owns:

- Workbench planning and lifecycle records;
- architectural synthesis;
- shared-file edits;
- integration decisions;
- branch and pull-request state;
- review replies and thread resolution;
- validation requests;
- readiness and merge;
- the final completion report.

Team subagents must not mutate those surfaces.
The active harness may coordinate subagents on Gizmo's behalf.

This rule preserves
[agent feature ownership](../dynamic-skills/agent-feature-ownership.md).

## Subagent task contract

Every subagent task must declare:

- a stable task ID;
- one semantic role or team identity;
- its exact baseline;
- its purpose;
- its allowed files or evidence surface;
- its read and write resource claims;
- the exact resource claims that form any read-only evidence surface;
- whether it is read-only;
- its dependencies;
- its hierarchy depth bound;
- its expected result shape;
- its acceptance evidence;
- forbidden mutations;
- its parent-owned join.

Create one disposable worker attempt only when the task is ready and its exact
starting frontier exists.

Do not create a second worker for the same task and attempt.

A retry is a new attempt of the same logical task.

- The worker returns a bounded result to the parent.
- The result contains:

- status;
- summary;
- evidence;
- affected paths;
- proposed changes or a verified commit handoff;
- risks;
- notes for the parent.

- The parent validates the result against current task state.
- The parent does not merge worker conclusions blindly.

## Task discovery and ready waves

Gizmo recursively discovers every necessary bounded task before that task is
dispatched.

1. Start from the requested outcomes.
2. Identify every direct provider needed for each outcome.
3. Repeat for each provider until all leaves are independently executable.
4. Create one task record for every reached task.
5. Assign exactly one team identity to every task record.
6. Freeze the initial known graph before dispatch.
7. Run deterministic topology and cycle validation.
   - A cycle fails closed.
   - Report the blocked dependency to Gizmo instead of waiting.
8. Freeze resource claims, acceptance evidence, stable task order, and the
   parent-owned join.

### Ready wave dispatch

A write provider satisfies its consumer edge only when it is:

- terminal-successful;
- semantically accepted by the responsible owner;
- commit-verified against its declared frontier and resource scope; and
- integrated into the consumer's Git frontier.

A read-only provider satisfies its consumer edge only when it is:

- terminal-successful;
- semantically accepted by the responsible owner;
- verified against its exact source commit; and
- accepted as evidence in parent task state.

Dispatch follows these rules:

- A task becomes ready when every direct provider satisfies its edge barrier.
- A task is not selectable until its exact starting Git frontier exists.
- Read-only evidence is not required in Git ancestry.
- Every attempt leases its resource claims.
- A consumer lease also includes evidence-surface claims it relies on.
- Worker termination does not release the lease.
- Gizmo releases it only after conclusively dispositioning the output.
- The harness visits ready pending tasks in stable task order.
- It first excludes tasks that conflict with any active lease from prior waves.
- It then greedily selects a task when its claims do not conflict with claims
  already selected for the new wave.
- Claims conflict when they overlap and either task writes.
- The resulting set is the deterministic maximal safe wave.
- The harness snapshots every selected starting frontier before creating any
  attempt in that wave.
- It creates one worker attempt for each selected task.
- Ready tasks excluded by conflicts remain pending for the next recomputation.
- Read-only audits may overlap, including audits of the same evidence.
- Concurrent writers require isolated workspaces and disjoint resource claims.
- After each Git integration or read-only evidence acceptance, Gizmo recomputes
  readiness on affected outgoing edges.
- Each newly ready successor binds to the exact integrated frontier that
  contains its complete write-predecessor closure.
- Unrelated work continues. No global wait separates waves.
- The all-task terminal barrier exists only for the final parent-owned join.

### Output disposition and lease release

Gizmo records exactly one conclusive disposition for each terminal output.

- **Accepted write:** verify the commit and scope, then integrate it.
  Complete any resulting stale-evidence and consumer invalidation before lease
  release.
- **Accepted read-only:** verify the exact source, then accept the evidence into
  parent task state.
- **Rejected or cancelled:** record that the output cannot be used.

The attempt lease remains held until its disposition is complete. Every lease
release triggers readiness and wave recomputation.

### Read-only evidence stability

The task record names every resource claim used to produce read-only evidence.
Those claims are its evidence surface.

Before consumer dispatch:

1. Compare the evidence surface at the provider's exact source commit with the
   consumer's exact frontier.
2. Treat the evidence as head-stable only when every claimed resource has the
   same content identity.
3. Trigger this check whenever a write integration overlaps the evidence
   surface.
4. If the surface changed, identify every consumer attempt that relied on the
   evidence.
5. Invalidate every active or terminal-but-unaccepted consumer attempt.
6. Stop or cancel active attempts.
7. Reject completed-but-unaccepted outputs.
8. Record every invalidated output as unusable.
9. Release each consumer lease only after that disposition is recorded.
10. Invalidate the accepted evidence.
11. Rerun the read-only provider against the exact new consumer frontier.
12. Verify the exact source commit and accept the replacement evidence in parent
   task state.
13. Retry each affected consumer as a fresh attempt.
14. Recompute readiness after reacceptance and every lease release.

Only consumers of the changed evidence surface are delayed. Independent claims
remain eligible for parallel work.

### Late provider discovery

The frozen initial graph controls dispatch. A worker cannot add its own task or
dependency edge.

When a running task discovers an unknown provider:

1. The worker reports the provider and affected consumer contract.
2. The harness invalidates the current attempt.
3. The harness stops or cancels that attempt.
4. Gizmo adds the bounded provider task and dependency edge.
5. Gizmo recursively discovers any dependencies of the new provider.
6. Gizmo replans the affected graph in stable task order.
7. Gizmo reruns deterministic topology and cycle validation.
   - A cycle fails closed.
   - Gizmo receives the blocked dependency instead of waiting.
8. Gizmo freezes the validated affected graph.
9. Unaffected tasks continue from their existing records and frontiers.
10. A write provider passes through commit verification and Git integration.
11. A read-only provider passes through exact-source verification and evidence
   acceptance in parent task state.
12. The consumer retries only as a fresh attempt from a fresh frontier after
    every new provider barrier is satisfied.

Output from the invalidated attempt cannot satisfy acceptance or integration.

## Module-oriented feature development

Module-oriented work follows
[module-oriented-development.md](module-oriented-development.md).

- Keep the feature dependency DAG separate from agent parent lineage.
- Use the named read-only semantic roles in the
  [module expert registry](../../teams/ai/architecture/module-experts.md).
- Use the active harness to create and coordinate module experts and
  implementation workers.
- Invoke `internal_api_expert` when a changed contract crosses a module
  boundary.
- Freeze provider-consumer edges before implementation.
- Continue from accepted providers to immediate consumers.
- Give every write-capable worker an isolated workspace.
- Verify every returned commit against its exact baseline and allowed paths.
- Bind every downstream task to the exact integrated provider commit.
- Keep shared files and lifecycle state with Gizmo.

The plan declares a task-specific hierarchy depth bound.
The harness enforces that bound.
A child may delegate within its assigned task only.
Nested delegation cannot add a feature-DAG node, widen write scope, or acquire
delivery authority.
`ModuleExpertEvidence`, Markdown, and `parentActions` are recommendations.
They do not authorize descendants or lifecycle mutations.

## Team-oriented implementation

Implementation delegation also follows
[Team-oriented development](team-oriented-development.md).

- Assign each task to AI, development core, security, SRE, or web development
  before starting workers.
- Give every team worker one exact team identity and explicit code and Cortex
  paths.
- Keep write-capable team agents in isolated workspaces with disjoint scopes.
- Require each team agent to own its implementation, tests, Cortex updates,
  review fixes, and validation fixes.
- Let a team agent report a dependency on another team to Gizmo.
- Do not let the requesting team implement the foreign provider in its own
  layer.
- Keep shared files and GitHub, Workbench, validation, readiness, and merge
  state with Gizmo.
- Give each worker only its team entry contract and exact task-relevant Cortex
  authorities. Do not attach every graph or the shared corpus.
- Treat the parent task contract as the portable routing and capability
  authority.
- Treat repository profile files as non-authoritative.

Team ownership does not add hierarchy depth or scheduling authority.

## Hierarchical event protocol

The active harness owns the live subagent hierarchy.

Its native control path includes:

- creation and communication;
- dependency-ready scheduling;
- retries and cancellation;
- terminal barriers;
- nested delegation within declared bounds;
- parent and root synthesis.

It also owns native worker labels or names, same-model inheritance, and any
explicit model selection.

Repository event streams and semantic views are optional human evidence.
They are not lifecycle authority for native harness delegation.

### Agent action streams

An optional JSONL stream may record bounded observable actions and outcomes.
It must never record:

- prompts;
- hidden model reasoning;
- credentials or secrets;
- raw command output;
- raw SDK errors or stack traces.

When retained, an event should identify the source commit, task, attempt,
parent lineage, local sequence, and timestamp.

- Sequence is monotonic inside one stream.
- Cross-stream global ordering is not claimed.
- A retry may receive a new attempt stream.
- Child streams never decide eligibility, joins, retries, or completion.

The existing Loom recording commands may preserve optional audit evidence.
Ordinary native delegation does not require `start`, `admit`, `record`, or
`finalize` before the harness proceeds.

### Semantic materialized views

A Markdown view may preserve an agent's conclusions for human inspection.

- Label agent-authored and machine-authored content clearly.
- Keep secrets, prompts, and hidden reasoning out of the view.
- Never parse Markdown to decide workflow state.
- Never require a view before dispatch, continuation, retry, join, or
  completion.

### Parent aggregation and continuation

The harness passes child results to the owning parent and enforces declared
barriers.

Before integration, the parent:

1. checks task identity and lineage;
2. verifies the exact baseline;
3. verifies changed paths and commit ancestry;
4. verifies acceptance evidence;
5. reconciles failures and disagreements;
6. integrates accepted commits in deterministic dependency order;
7. accepts read-only evidence into parent task state or integrates a write
   commit into the Git frontier;
8. checks affected read-only evidence surfaces after a write integration;
9. invalidates active and terminal-but-unaccepted consumers of stale evidence;
10. stops or cancels active consumers and rejects unaccepted terminal outputs;
11. records rejected or cancelled output as unusable;
12. releases each lease after its conclusive disposition;
13. recomputes readiness and wave selection after every lease release;
14. reruns stale evidence at the consumer frontier;
15. retries affected consumers as fresh attempts;
16. recomputes readiness after acceptance or reacceptance;
17. binds downstream work to the exact integrated frontier containing its
   complete write-predecessor closure; and
18. selects the next deterministic maximal safe wave against active leases.

The parent may author a Markdown summary for humans.
That summary is optional.

### Processing storage and retention

Optional local execution evidence lives under the ignored project root
`workflow/processing/`.

Path contracts are:

- `workflow/processing/<workflow>/<run-id>/events.jsonl` for optional run
  evidence;
- `workflow/processing/<workflow>/<run-id>/agents/<task>/attempt-<n>/events.jsonl`
  for one agent attempt;
- `workflow/processing/<workflow>/<run-id>/agents/<task>/attempt-<n>/result.json`
  for its typed terminal projection;
- `workflow/processing/<workflow>/<run-id>/agents/<task>/attempt-<n>/view.md`
  for its semantic projection; and
- `workflow/processing/<workflow>/<run-id>/view.md` for the root aggregate.

Compiled Loom workflows may rely on their own processing store.
Native harness delegation does not.

When optional evidence is retained, cleanup is explicit.
It remains separate from disposable `.cortex/.session/` reflection memory.

## Safe delegation patterns

### Full Cortex garbage collection

A full-tree Cortex audit MUST fan out when two or more document families are in
scope.

Useful read-only partitions include:

- workflows and references;
- design docs and product specs;
- dynamic skills and entry points;
- code, Task, and CI evidence.

Gizmo resolves conflicting findings and assigns the final edit to an AI team
subagent.

A topic-local one-hop consistency check does not require fan-out.

### Structural coherence

Use the
[structural refactoring workflow](../../teams/ai/workflows/structural-refactoring.md)
when code
or Cortex structure is the requested maintenance surface.

- The registry contains two repository-reading structural experts.
- `system_coherence_synthesizer` receives only verified evidence.
- Gizmo declares all tasks and integrates accepted corrections from the
  responsible team subagents.
- Structural roles do not delegate or create another tier.

### Broad repository inventory

Repository-wide migrations MUST use read-only workers when two or more disjoint
packages or ownership layers are in scope.

The parent owns the cross-layer interface and migration order.

Core, WASM, and web interface changes preserve provider order.

1. Complete, accept, commit-verify, and integrate the core provider.
2. Start WASM from the exact integrated frontier containing core.
3. Complete, accept, commit-verify, and integrate WASM.
4. Start web from the exact integrated frontier containing core and WASM.

Independent ready tasks continue while this chain advances. The chain does not
create a mission-wide wait.

### Independent CI failures

- Two or more unrelated failed job families MUST use one diagnostic worker per
  family.
- Workers inspect exact-head evidence.
- Gizmo correlates root causes.
- Gizmo sends each fix to the responsible team subagent.
- The responsible team subagent implements and tests the fix.
- Workers do not push or trigger replacement checks.

### Review findings

Two or more independent findings MUST use child workers for verification.

The PR owner keeps all code integration and GitHub mutation authority.

Workers do not reply, resolve, label, push, or merge.

### Dependency refreshes

Read-only inventory MUST fan out when two or more independent dependency
surfaces are in scope.

Surfaces include Rust workspaces, JavaScript workspaces, workflows, Docker
images, and downloaded tools.

Shared lockfile updates stay serialized.

### Multi-surface product audits

Release security, accessibility, responsive behavior, and visual-state audits
MUST fan out when two or more evidence surfaces do not overlap.

The feature owner resolves product and security tradeoffs.

## Unsafe delegation patterns

Keep one owner when work is:

- a small cohesive edit;
- tightly coupled in one file or abstraction;
- dependent on an unstabilized interface;
- operating one live browser session;
- mutating production infrastructure;
- changing shared GitHub or Workbench state;
- reading secrets that are not required by the child task.

- Concurrent writers must not share one worktree.
- Write-capable workers need isolated worktrees or disposable workspaces.
- Their file scopes must be disjoint.
- Every retry needs fresh isolated attempt state from the declared baseline.
- A successful writer returns a commit with verifiable baseline ancestry.
- The parent still owns integration.

## Machine-managed workflows

During reflection, apply the
[workflow improvement review](../../teams/ai/dynamic-skills/self-improvement.md#workflow-improvement-review)
to repeated and stable procedures.

This delegation workflow still owns the worker boundary:

- semantic work uses bounded child workers;
- deterministic work uses tools;
- the active harness owns native worker coordination;
- Gizmo defines and reviews the integration; and
- child workers do not acquire delivery authority.

The architecture boundary is defined in
[agent-workflow-orchestration.md](../../teams/ai/design-docs/agent-workflow-orchestration.md).

## Validation

Before integration, verify:

- every worker used its declared exact baseline;
- every team worker used its declared team identity;
- the repository task contract did not prescribe a native label or model;
- every reached task has a task record;
- every selected ready task has one harness-visible worker attempt;
- every task record declares read and write resource claims;
- every read-only task record declares its evidence surface;
- every child records the correct parent lineage;
- every task stayed inside its declared hierarchy depth bound;
- no descendant widened its assigned task or write scope;
- every parent result covers the declared child terminal barrier;
- write scopes did not overlap;
- every write-capable attempt used an isolated workspace;
- every retry started from fresh isolated state;
- every accepted commit descends from its exact baseline;
- every accepted commit changes only allowed paths;
- every downstream task binds to the exact integrated provider commit;
- every downstream task's frontier contains its complete write-predecessor
  closure;
- read-only evidence was accepted in parent task state without a Git-ancestry
  requirement;
- integration follows deterministic dependency order;
- every wave was greedily maximal under stable task order and resource claims;
- every wave excluded conflicts with every unreleased claim lease;
- every consumer lease included relied-on evidence-surface claims;
- worker termination did not release a claim lease;
- every claim lease remained held until conclusive output disposition;
- accepted writes were verified and integrated before lease release;
- accepted read-only evidence was verified and accepted before lease release;
- rejected or cancelled output was recorded as unusable before lease release;
- every lease release triggered readiness and wave recomputation;
- every selected frontier was snapshotted before wave attempts were created;
- conflict-excluded ready tasks remained pending for recomputation;
- every late provider invalidated and stopped or cancelled the affected attempt;
- every graph mutation reran deterministic topology and cycle validation;
- every cycle failed closed and reported its blocked dependency to Gizmo;
- every late-provider consumer retry used fresh attempt state and a fresh
  frontier;
- readiness was recomputed after every Git integration or evidence acceptance;
- overlapping write integrations triggered evidence-surface stability checks;
- stale evidence invalidated every active or terminal-but-unaccepted consumer;
- active consumers were stopped or cancelled;
- completed-but-unaccepted consumer outputs were rejected as unusable;
- stale read-only evidence was rerun and reaccepted at the exact consumer
  frontier;
- each affected consumer retried as a fresh attempt;
- readiness was recomputed after read-only evidence reacceptance;
- no global barrier delayed dependency-ready work before the final join;
- optional JSONL and Markdown evidence did not gate harness progress;
- the parent reviewed all evidence;
- only Gizmo mutated shared lifecycle state.
