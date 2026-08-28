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
- Let the active harness own same-model inheritance and any explicit model
  selection.
- Do not encode model selection in the repository task contract.
- If the active harness cannot create or start the required authorized
  attempts:
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
- exactly one team identity;
- an explicit functional owner;
- any separate semantic role or expert required by the task;
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

Team identity selects only the worker's team context. The explicit functional
owner controls semantic acceptance. For an expertise task, the team identity
names the expertise-provider team while the functional owner remains the
acceptance owner whose approval is required before Gizmo integration. A
semantic role or expert selects bounded knowledge. None of these fields can
replace another.

### Attempts and results

Create one disposable worker attempt only when the task is ready and its exact
starting frontier exists.

Do not create a second worker for the same task and attempt.
An active worker attempt whose claims remain leased must not create any worker
attempt. Worker claims are not subleased.

A retry is a new attempt of the same logical task.

- The worker returns a bounded result to Gizmo under its frozen parent-lineage
  metadata.
- The result contains:

- status;
- summary;
- evidence;
- affected paths;
- proposed changes or a verified commit handoff;
- risks;
- notes for Gizmo.

- A worker that discovers a missing dependency returns that need to Gizmo. It
  does not create the provider or another worker.

- Gizmo validates the result against current task state.
- Gizmo does not merge worker conclusions blindly.

## Task discovery and admission batches

Gizmo recursively discovers every necessary bounded task before that task is
dispatched.

1. Start from the requested outcomes.
2. Identify every direct provider needed for each outcome.
3. Repeat for each provider until all leaves are independently executable.
4. Create one task record for every reached task.
5. Assign exactly one team identity to every task record.
6. Record each task's explicit functional owner. For an expertise task, record
   that functional owner as its acceptance owner separately from the
   expertise-provider team identity.
7. Freeze the initial known graph before dispatch.
8. Derive deterministic execution constraints.
   - Every writer whose write claims overlap a read-only provider's evidence
     surface is a predecessor of that evidence provider, regardless of their
     existing declared order.
   - Otherwise-unordered conflicting tasks are serialized in stable execution
     order instead of making the plan invalid.
9. Run deterministic topology and cycle validation over declared and derived
   constraints.
   - A cycle fails closed.
   - An existing evidence-provider-before-writer dependency conflicts with the
     required writer-before-provider constraint and is rejected before
     dispatch.
   - Report the blocked dependency to Gizmo instead of waiting.
10. Freeze resource claims, acceptance evidence, stable task order, and the
   parent-owned join.

### Typed provider handoffs

A write provider satisfies its consumer edge only when it is:

- terminal-successful;
- semantically accepted by the task's recorded functional owner;
- commit-verified against its declared frontier and resource scope; and
- integrated into the consumer's Git frontier.

A read-only provider satisfies its consumer edge only when it is:

- terminal-successful;
- semantically accepted by the task's recorded functional owner;
- represented by a versioned typed evidence handoff;
- verified against its exact source commit and evidence-surface content
  identities; and
- accepted as evidence in parent task state.

The evidence handoff identifies the plan generation, task, attempt, team,
source commit, evidence artifact and digest, and every declared
evidence-surface claim with its content identity. The evidence surface is
non-empty, separately represented, and covered by the task's read claims. An
empty, unverified, wrong-generation, or wrong-team handoff cannot satisfy a
provider edge.

### Ready admission

Dispatch follows these rules:

- A task becomes ready when every direct provider satisfies its edge barrier.
- A task is not selectable until its exact starting Git frontier exists.
- Read-only evidence is not required in Git ancestry.
- Loom/Nook deterministically computes eligible candidates, claim conflicts,
  available capacity, required leases, and exact starting-frontier data.
- A computed consumer lease includes the evidence-surface claims it relies on.
- Gizmo validates the computed candidate batch against the frozen generation.
- Gizmo selects and admission-authorizes task records only from that valid
  batch and freezes and owns each selected record's exact starting frontier.
- Loom/Nook records the computed lease before Gizmo supplies the authorized
  bounded contract to the active harness.
- Worker termination does not release the lease.
- Gizmo records a conclusive output disposition before Loom/Nook releases it.
- Loom/Nook computes available capacity as
  `max(0, maxConcurrency - unreleasedLeaseCount)`.
- Loom/Nook visits ready pending tasks in stable task order.
- It first excludes tasks that conflict with any unreleased lease from prior
  admission batches.
- It then greedily selects a task when its claims do not conflict with claims
  already included in the new candidate batch.
- Claims conflict when they overlap and either task writes.
- Selection stops when available capacity is exhausted.
- The resulting set is the deterministic maximal safe candidate batch under
  that capacity.
- Gizmo freezes every selected starting frontier before requesting any attempt
  in that batch.
- The active harness creates, starts, runs, communicates with, retries, or
  cancels attempts only for Gizmo-authorized records. It does not compute
  candidates, select or admit task records, or snapshot or change frontiers.
- Ready tasks excluded by conflicts remain pending for the next recomputation.
- Read-only audits may overlap, including audits of the same evidence.
- Concurrent writers require isolated workspaces and disjoint resource claims.
- After each Git integration or read-only evidence acceptance, Loom/Nook
  recomputes readiness and exact frontier data on affected outgoing edges.
- Gizmo validates that data and freezes each authorized successor's exact
  integrated frontier containing its complete write-predecessor closure.
- Unrelated work continues. Admission batches are not completion or integration
  barriers.
- The all-task terminal barrier exists only for the final parent-owned join.

### Output disposition and lease release

Gizmo records exactly one conclusive disposition for each terminal output.

- **Accepted write:** verify the commit and scope, then integrate that provider
  immediately without waiting for other tasks from its admission batch.
- **Accepted read-only:** verify the typed evidence handoff and exact source,
  then accept the evidence into parent task state without waiting for other
  tasks from its admission batch.
- **Rejected or cancelled:** record that the output cannot be used.

The attempt lease remains held until its disposition is complete. Every lease
release triggers Loom/Nook readiness and candidate recomputation. Completion of
provider A may therefore make A's consumer eligible while unrelated provider B
from the same admission batch is still active.

### Evidence-safe execution ordering

For a read-only evidence provider, the evidence surface is the exact non-empty
set of its read claims whose content contributes to its evidence. An
overlapping writer is any task with a write claim that overlaps any claim in
that surface.

Before dispatch, the deterministic validator derives a
writer-before-evidence-provider constraint for every overlapping writer. This
precedence is mandatory even when declared provider dependencies already order
the tasks. The evidence provider starts only from a frontier containing every
such integrated writer. Its consumers start only after the typed evidence
handoff is verified and accepted.

For other otherwise-unordered overlapping claims, the validator derives a
stable serialization constraint. The later task starts from a frontier
containing the earlier integrated write. Overlap therefore delays a task; it
does not reject an otherwise valid plan.

#### Validation outcome

The combined declared and derived execution graph must remain acyclic. If the
declared graph requires an evidence provider, or any of its consumers, to
precede an overlapping writer, the mandatory writer-before-provider edge
creates a cycle. The plan is invalid and must be rejected before any task is
dispatched. Gizmo must split the evidence surface, remove the overlap, or
repair the provider dependencies.

Ordinary execution has no implicit evidence invalidation or selective
revalidation exception. A plan may permit evidence-before-writer ordering only
through a separately specified full-generation revalidation protocol that
prevents old evidence and every result derived from it from being accepted in
the replacement generation. This workflow defines no such protocol, so it
fails closed. Authorized attempt creation, start, run, communication, retry,
cancellation, and lifecycle remain harness-owned.

### Immutable generation restart

The frozen initial graph controls dispatch. A worker cannot add its own task or
dependency edge.

Any late provider, edge, claim, acceptance, or other plan mutation creates a
new immutable plan generation and digest. Selective state or handoff migration
is not supported.

#### Missing dependency

A missing dependency discovered by an active worker is a late provider. The
worker returns the need to Gizmo without dispatching it. Gizmo records a
conclusive unusable disposition for the old attempt and follows the complete
generation restart below. The replacement generation records the provider as
a separate task with its own team identity, functional owner, resources, and
edges. Only after every old-generation attempt is conclusively dispositioned
may Loom/Nook compute replacement candidates for Gizmo validation and
admission authorization. The harness creates attempts only for those authorized
records.

For any late mutation:

1. Report it to Gizmo and invalidate the complete old generation.
2. Gizmo requests cancellation through the active harness, rejects
   terminal-but-unaccepted output, and records each conclusive disposition
   before Loom/Nook releases its lease.
3. Abandon accepted evidence and private integration state.
4. Rebuild and cycle-check the graph as a new immutable generation.
5. Let Loom/Nook compute replacement candidate and frontier data; Gizmo
   validates, admission-authorizes, and freezes each selected frontier; and the
   active harness retries only those authorized records.

Old-generation results may remain inspectable but cannot be reused.

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
- Keep shared files and integrated or external delivery state with Gizmo.

The plan declares a task-specific hierarchy depth bound.
The frozen graph records parent lineage and bounded authority for every task.
Those fields support validation and result aggregation; they do not authorize
an active worker to create another worker. Only Gizmo may add a newly discovered
dependency through a replacement immutable generation, and only the harness
may create its attempt after Gizmo admission-authorizes it and freezes its
frontier following old-generation disposition.
`ModuleExpertEvidence`, Markdown, and `parentActions` are recommendations.
They do not authorize worker creation or lifecycle mutations.

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

The active harness owns only worker-attempt creation and live attempt execution
for Gizmo-authorized records in the frozen task lineage.

Its native control path includes:

- creation, start, run, and communication for authorized attempts;
- retries and cancellation requested through Gizmo;
- terminal-state reporting.

No active leased worker attempt may invoke that creation authority. A worker
reports a missing dependency to Gizmo for immutable generation restart.

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
They do not select or admit native task records. Gizmo authorization remains
mandatory before the harness creates or proceeds with an attempt.

### Semantic materialized views

A Markdown view may preserve an agent's conclusions for human inspection.

- Label agent-authored and machine-authored content clearly.
- Keep secrets, prompts, and hidden reasoning out of the view.
- Never parse Markdown to decide workflow state.
- Never require a view before dispatch, continuation, retry, join, or
  completion.

### Gizmo aggregation and continuation

The harness passes worker results to Gizmo with their frozen parent lineage.
Loom/Nook computes barrier and candidate state. Lineage does not imply a live
parent worker.

Before integration, Gizmo verifies identity, lineage, baseline, scope,
handoff, and the recorded functional owner's semantic acceptance. It
dispositions each result provider-locally and integrates accepted writes or
evidence. Loom/Nook then releases the lease and recomputes readiness, conflicts,
capacity, and exact frontier
data. Gizmo validates that computation and freezes authorized successors'
frontiers. Failures remain Gizmo-owned.

Gizmo may author a Markdown summary for humans.
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
- every task recorded an explicit functional owner separately from team
  identity;
- every expertise result received semantic acceptance from its recorded
  functional owner before Gizmo integration;
- the repository task contract did not prescribe a native label or model;
- every reached task has a task record;
- every selected ready task has one harness-visible worker attempt;
- every task record declares read and write resource claims;
- every read-only task record declares a non-empty evidence surface covered by
  its read claims;
- every task records its correct frozen parent lineage and authority bound;
- no active leased worker attempt created another worker attempt;
- every missing dependency returned to Gizmo instead of being self-dispatched;
- every newly discovered provider entered a replacement immutable generation
  as a separate normally admitted task after old-attempt disposition;
- Gizmo's aggregate covers every terminal barrier declared by the frozen task
  lineage;
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
- declared and derived execution order was deterministic and acyclic;
- admission was stable, conflict-safe, and capped by available
  `maxConcurrency` after every unreleased lease;
- Loom/Nook computed eligible candidates, conflicts, capacity, leases, and
  exact frontier data;
- Gizmo validated each computed batch, selected and admission-authorized task
  records, and froze and owned every exact starting frontier;
- the active harness created and operated attempts only for Gizmo-authorized
  records and never selected or admitted tasks or snapshotted or changed a
  frontier;
- every consumer lease included relied-on evidence-surface claims;
- worker termination did not release a claim lease;
- every claim lease remained held until conclusive output disposition;
- accepted writes were verified and integrated before lease release;
- accepted read-only evidence used the verified typed handoff;
- rejected or cancelled output was recorded as unusable before lease release;
- every lease release triggered Loom/Nook readiness and candidate
  recomputation;
- Gizmo froze selected frontiers before attempts were created;
- conflict-excluded ready tasks remained pending for recomputation;
- otherwise-unordered non-evidence conflicts were serialized and every writer
  overlapping an evidence surface preceded its read-only provider;
- evidence-hazard cycles failed closed before dispatch;
- no declared evidence-provider-before-writer dependency bypassed the
  mandatory writer-before-provider constraint;
- late mutations cancelled or rejected every old-generation attempt, migrated
  no result or private state, and retried every reached task in a validated new
  generation;
- every cycle failed closed and reported its blocked dependency to Gizmo;
- Loom/Nook recomputed readiness and frontier data after every Git integration
  or evidence acceptance;
- provider results were dispositioned locally without a whole-admission-batch
  barrier;
- no known evidence hazard required rollback or invalidation of an already
  accepted consumer;
- no global barrier delayed dependency-ready work before the final join;
- optional JSONL and Markdown evidence did not gate harness progress;
- Gizmo reviewed all evidence;
- only Gizmo mutated integrated and external delivery state, and only the
  active harness owned worker-attempt lifecycle.
