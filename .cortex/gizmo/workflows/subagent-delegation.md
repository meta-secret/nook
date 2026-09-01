# Subagent Delegation

## Overview

- Use this workflow when different subagents can complete separate tasks.
- Keep Gizmo as the delivery owner.
- Team subagents implement their assigned tasks. They do not control delivery.

## Decision rule

A capable agent environment MUST delegate when all of these conditions hold:

1. The request contains at least two separate team tasks.
2. Each selected ready task can receive an exact starting frontier.
3. Write-capable tasks run sequentially in the current shared checkout.
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

### Executable enforcement gate

The full admission contract in this workflow applies to every ordinary
multi-team delegation path, not only module delivery. Before dispatch, an
installed typed Loom/Nook validator and focused tests must encode and enforce:

- immutable generation identity, team identity, functional owner, resource
  claims, repository evidence surfaces, typed accepted provider-evidence
  inputs, provider edges, task-attempt identity and admission cardinality, and
  acceptance evidence;
- derived evidence-hazard ordering, stable conflict serialization, topology,
  and cycle rejection;
- deterministic eligibility, conflict, capacity, lease, and exact-frontier
  computation; and
- Gizmo batch validation, record selection, admission authorization, and
  frontier freezing before harness attempt creation.

The currently installed generic agent-workflow delegation schema does not
encode that contract, and the module-delivery validator is not a universal
ordinary-delegation validator. Therefore ordinary multi-team delegation fails
closed before any worker attempt. Do not manually approximate the contract,
reuse a narrower validation result, or dispatch through an unvalidated path.
Report the missing typed-runtime capability to Gizmo and wait for compatible
executable enforcement.

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

## Gizmo Prime and feature-slice Gizmos

Exactly one Gizmo Prime—the existing root Gizmo—owns delivery. This formal name
does not add an engineering team or another root coordinator.

Gizmo Prime owns:

- Workbench planning and lifecycle records;
- architectural synthesis;
- shared-file serialization, exact writer grants, and write sequencing;
- shared-branch sequencing decisions;
- branch and pull-request state;
- review replies and thread resolution;
- validation requests;
- readiness and merge;
- the final completion report.

Team subagents must not mutate those surfaces.
The active harness may coordinate subagents on Gizmo Prime's behalf.

### Adaptive cardinality

- Gizmo Prime creates one named immutable feature-slice Gizmo Workbench record
  by default for one semantic PR slice.
- Every record reports authored deletions separately. Deletion totals never
  determine record count.
- It does not add feature-slice Gizmos because a PR approaches or exceeds its
  line budget.
- Team Agent count never determines this cardinality.
- A feature-slice Gizmo record groups Team Agent contracts and accepted results
  for exactly one PR slice. It is not a process, agent, worker attempt,
  controller, or team identity and performs no coordination or handoff.
- Gizmo Prime routes task contracts by their assigned Gizmo ID, receives Team
  Agent handoffs directly, and aggregates verified results under the record.
  Only the existing harness operates the admission-authorized attempts.

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
- its allowed files;
- its read and write resource claims;
- whether it is repository-reading read-only, evidence-only synthesis, or
  write-capable;
- its repository evidence surface:
  - a repository-reading read-only task declares the exact non-empty subset of
    its read claims used to produce evidence;
  - an evidence-only synthesis task declares empty repository read claims,
    write claims, and evidence surface; and
  - a write-capable task declares an empty evidence surface;
- for evidence-only synthesis, its frozen provider edges, expected producer
  identities, typed input schema, and acceptance criteria; exact accepted
  artifact, digest, and provenance identities are not knowable yet;
- its dependencies;
- its hierarchy depth bound;
- its expected result shape;
- its acceptance evidence;
- forbidden mutations;
- its parent-owned join.

Team identity selects only the worker's team context. The explicit functional
owner controls semantic acceptance. An expertise task uses the provider team
as its team identity. Its functional owner remains the acceptance owner. Gizmo
continues only after that owner approves. A semantic role or expert selects
bounded knowledge. None of these fields can replace another.

### Active-harness activity-line context

Gizmo owns the activity-line PR context for each live attempt. The active
harness carries it for communication only. It is not part of the declared or
frozen subagent task contract.

- The context carries `(<number>)` with the exact positive pull-request number,
  `(pending)`, or `(none)` for inclusion on every user-visible activity line.
- The harness derives the worker actor token from its immutable team identity:
  `AI`, `DEV-CORE`, `SECURITY`, `SRE`, or `WEB-DEV`.
- The active harness supplies the authoritative host-local clock source for
  worker communication.
- The worker reads a fresh `HH:mm` from that source immediately before each
  activity-line emission.
- An unavailable authoritative clock blocks worker communication through the
  harness. The harness must not supply a fallback source.
- `GIZMO` identifies only Gizmo Prime, and `SKILL` identifies only an actively
  executing skill. Neither token is a worker team identity.
- Gizmo supplies the context through the active harness before the worker's
  first user-visible activity.
- When Gizmo creates the pull request, it refreshes the context before the
  worker's next user-visible activity.
- The worker uses the refreshed PR token on its next activity line.
- The worker must not infer pull-request identity from a branch or workspace.
- The context does not alter the generation, task identity, scope, retry
  contract, claims, provider edges, evidence, or frontier.
- The context grants no GitHub or delivery authority.

### Attempts and results

Create one disposable worker attempt only when that exact task attempt is
admission-authorized, the logical task is ready, and its exact starting frontier
exists.

Each authorized `(task ID, attempt ID)` maps to exactly one harness-visible
worker attempt. Do not create a second worker for the same task attempt, and
never allow more than one concurrently active attempt for one logical task.
An active worker attempt whose claims remain leased must not create any worker
attempt. Worker claims are not subleased.

#### Retry sequencing

Retry sequencing follows these rules:

- Before execution, the typed immutable generation plan declares `maxAttempts`
  as a positive finite integer.
- `maxAttempts` may not change after execution begins.
- Exhaustion behavior is canonical and hard-coded. It blocks the task and its
  dependent scope.
- A worker attempt consumes one attempt from the bound when it starts.
- A normal retry keeps the exact frozen task contract, acceptance evidence,
  generation, and starting-frontier rule.
- A normal retry receives fresh isolated attempt state.
- A task-contract, resource-claim, provider-edge, or acceptance-evidence change
  requires a new immutable generation. It is not a retry.
- A retry may be admitted only after the preceding attempt is terminal,
  conclusively dispositioned, and no longer active.
- Sequential attempts use unique attempt IDs. They must never be concurrent.
- A retry may proceed only when the logical task has an unused attempt.
- Exhaustion without accepted completion applies the hard-coded blocked state.
- Failure to create, dispatch, or start an authorized attempt follows the root
  immediate-blocker rule. It does not enter retry sequencing.

- The worker returns a bounded result to Gizmo under its frozen parent-lineage
  metadata.
- The result contains:

- status;
- summary;
- evidence;
- affected paths;
- proposed changes or a verified direct commit;
- risks;
- notes for Gizmo.

- A worker that discovers a missing dependency returns that need to Gizmo. It
  does not create the provider or another worker.

- Gizmo validates the result against current task state.
- Gizmo does not merge worker conclusions blindly.

## Task discovery and admission batches

Gizmo recursively discovers every necessary bounded worker-executable team or
provider task before that task is dispatched. Parent-owned Gizmo control
operations are tracked separately and never enter this worker graph.

1. Start from the requested outcomes.
2. Identify every direct provider needed for each outcome.
3. Repeat for each provider until all leaves are independently executable.
4. Create one task record for every reached worker-executable team or provider
   task.
5. Assign exactly one team identity to every worker-executable team or provider
   task record.
6. Record each worker task's explicit functional owner. For an expertise task,
   record that functional owner as its acceptance owner separately from the
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
- present in the consumer's exact starting Git frontier.

A read-only provider satisfies its consumer edge only when it is:

- terminal-successful;
- semantically accepted by the task's recorded functional owner;
- represented by a versioned typed evidence handoff;
- provenance-verified under the applicable read-only contract; and
- accepted as evidence in parent task state.

For a repository-reading read-only provider, provenance verification binds the
handoff to its exact source commit and every non-empty evidence-surface claim's
content identity. The surface is separately represented and covered by the
task's repository read claims.

For an evidence-only synthesis provider, provenance verification binds the
handoff to a non-empty immutable list of typed accepted provider-evidence input
identities. Each input identifies its provider generation, task, attempt, team,
accepted artifact, digest, and underlying source provenance. The synthesis task
has empty repository read claims, write claims, and evidence surface and must
not inspect the repository. Empty or unaccepted provider inputs cannot satisfy
its contract.

#### Ordinary synthesis binding

The generation freezes the synthesis provider edges, expected producer
identities, typed input schema, and acceptance criteria before dispatch. Only
after all required providers are terminal-successful and accepted does Gizmo
bind an authorized synthesis attempt to their exact artifact, digest, and
provenance identities. That admission-time binding fills the frozen contract
and is not a plan mutation.

Every evidence handoff identifies its plan generation, task, attempt, team,
evidence artifact, and digest. It also identifies the applicable repository
surface or typed provider-input identities. An unverified, wrong-generation,
wrong-team, or wrong-attempt handoff cannot satisfy a provider edge.

### Ready admission

Dispatch follows these rules:

- A task becomes ready when every direct provider satisfies its edge barrier.
- A task is not selectable until its exact starting Git frontier exists.
- Read-only evidence is not required in Git ancestry.
- Loom/Nook deterministically computes eligible candidates, claim conflicts,
  available capacity, required leases, and exact starting-frontier data.
- A computed consumer lease includes the repository evidence-surface claims it
  relies on. Evidence-only synthesis admission instead binds its immutable
  non-empty typed accepted provider-evidence input identities.
- Gizmo validates the computed candidate batch against the frozen generation.
- Gizmo selects task records only from that valid batch, admission-authorizes
  one exact attempt ID for each selection, and freezes and owns each authorized
  task attempt's exact starting frontier.
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
  cancels only Gizmo-authorized task attempts. It does not compute
  candidates, select or admit task records, or snapshot or change frontiers.
- Ready tasks excluded by conflicts remain pending for the next recomputation.
- Read-only audits may overlap, including audits of the same evidence.
- At most one write-capable attempt may hold a lease.
- Read-only attempts may remain concurrent when their evidence scopes are safe.
- After each Git integration or read-only evidence acceptance, Loom/Nook
  recomputes readiness and exact frontier data on affected outgoing edges.
- Gizmo validates that data and freezes each authorized successor's exact
  accepted shared-branch commit containing its complete write-predecessor
  closure.
- Unrelated work continues. Admission batches are not completion or integration
  barriers.
- The all-task terminal barrier exists only for the final parent-owned join.

### Output disposition and lease release

Gizmo records exactly one conclusive disposition for each terminal output.

- **Accepted write:** verify the direct commit and scope, then continue from
  that commit without waiting for read-only tasks from its admission batch.
- **Accepted read-only:** verify the typed evidence handoff and its exact
  repository-source provenance or typed accepted provider-evidence inputs, then
  accept the evidence into parent task state without waiting for other tasks
  from its admission batch.
- **Rejected or cancelled:** record that the output cannot be used.

The attempt lease remains held until its disposition is complete. Every lease
release triggers Loom/Nook readiness and candidate recomputation. Completion of
provider A may therefore make A's consumer eligible while unrelated provider B
from the same admission batch is still active.

### Evidence-safe execution ordering

For a repository-reading read-only evidence provider, the evidence surface is
the exact non-empty set of its read claims whose content contributes to its
evidence. An overlapping writer is any task with a write claim that overlaps
any claim in that surface.

An evidence-only synthesis task has no repository evidence surface and creates
no writer-before-evidence edges from repository claims. Its readiness instead
requires accepted evidence matching every frozen provider edge, expected
producer identity, input schema, and acceptance criterion. Gizmo then binds the
exact accepted input identities while authorizing the attempt.

A failed or cancelled provider may yield a separate typed terminal observation
for diagnosis. That observation is not accepted provider evidence, cannot
satisfy a provider edge, and cannot make an evidence-only synthesis task ready.
It is not an input to ordinary accepted-evidence synthesis. Failure of a
required provider lane therefore stops that synthesis join. A separately
reviewed legacy diagnostic aggregator may consume terminal observations under
either the parent-authorized `loom-structural-experts` structural contract or
the separate static Cortex-audit contract. Neither output can satisfy an
ordinary provider edge or claim this admission contract.

#### Repository hazard order

Before dispatch, the deterministic validator derives a
writer-before-evidence-provider constraint for every overlapping writer. This
precedence is mandatory even when declared provider dependencies already order
the tasks. The evidence provider starts only from a frontier containing every
such accepted writer commit. Its consumers start only after the typed evidence
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

If stale read-only evidence requires re-execution, treat it as a plan mutation:
the complete old generation is invalid. Do not implicitly or selectively
invalidate or revalidate accepted consumers. Follow the complete restart below;
old-generation results may remain inspectable but are unusable in the
replacement generation.

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
3. Abandon accepted evidence and private admission state.
4. Rebuild and cycle-check the graph as a new immutable generation.
5. Let Loom/Nook compute replacement candidate and frontier data; Gizmo
   validates, admission-authorizes, and freezes each selected frontier; and the
   active harness creates a fresh attempt for every authorized replacement-
   generation record. An attempt for a surviving same logical task is a retry;
   an attempt for a newly discovered provider is that task's first attempt.

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
- Give every write-capable worker the current shared checkout.
- Lease only one write-capable worker at a time.
- Verify every returned commit against its exact baseline and allowed paths.
- Bind every downstream task to the exact provider commit.
- Keep shared-file serialization, writer grants, sequencing, and external
  delivery state with Gizmo. An assigned worker may edit only an exact shared
  file named by its frozen grant.

The plan declares a task-specific hierarchy depth bound.
The frozen worker graph records parent lineage and bounded authority for every
worker-executable team or provider task.
Those fields support validation and result aggregation; they do not authorize
an active worker to create another worker. The assigned Gizmo ID in plan and
task context binds Team Agent work to its passive slice record, but only Gizmo
Prime may add a newly discovered dependency through a replacement immutable
generation, and only the harness may create its attempt after Gizmo Prime
admission-authorizes it and freezes its frontier following old-generation
disposition.
`ModuleExpertEvidence`, Markdown, and `parentActions` are recommendations.
They do not authorize worker creation or lifecycle mutations.

## Team-oriented implementation

Implementation delegation also follows
[Team-oriented development](team-oriented-development.md).

- Assign each worker-executable team or provider task to AI, development core,
  security, SRE, or web development before starting workers.
- Give every team worker one exact team identity and explicit code and Cortex
  paths.
- Keep write-capable Team Agents sequential in the current shared checkout.
- Concurrent read-only agents must not mutate the checkout.
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

Before continuing from a worker result, Gizmo verifies identity, lineage,
baseline, scope, commit, and the recorded functional owner's semantic
acceptance. It dispositions each result provider-locally and accepts writes or
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

### Structural coherence

Use the
[structural refactoring workflow](../../teams/ai/workflows/structural-refactoring.md)
when code
or Cortex structure is the requested maintenance surface.

- The registry contains two repository-reading structural experts.
- Each repository-reading expert declares a non-empty repository evidence
  surface covered by its read claims.
- `system_coherence_synthesizer` and `SystemCoherenceSynthesis` remain legacy
  `loom-structural-experts` diagnostic identities. They accept verified
  structural `Completed` and `Failed` observations, cannot satisfy ordinary
  provider edges, and must not be reused for future ordinary accepted-evidence
  synthesis.
- Future ordinary synthesis requires a distinct typed role, profile, and result
  contract before implementation; no such identity or runtime support is
  declared here, so ordinary dispatch remains fail-closed.
- Gizmo declares all tasks and integrates accepted corrections from the
  responsible team subagents.
- Structural roles do not delegate or create another tier.

### Broad repository inventory

Repository-wide migrations MUST use read-only workers when two or more disjoint
packages or ownership layers are in scope.

The parent owns the cross-layer interface and migration order.

Core, WASM, and web interface changes preserve provider order.

1. Complete, accept, and commit-verify the core provider.
2. Start WASM from the exact accepted commit containing core.
3. Complete, accept, and commit-verify WASM.
4. Start web from the exact accepted commit containing core and WASM.

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

- Concurrent write-capable workers are prohibited.
- Write-capable workers use the current shared checkout and branch.
- Deterministically serialized scope overlaps must follow their declared
  precedence and must not hold concurrent leases.
- Every retry starts from the current accepted shared-branch commit.
- A successful writer returns a commit when Gizmo requests one.
- The parent owns write sequencing and external delivery state.

## Machine-managed workflows

During reflection, apply the
[workflow improvement review](../../teams/ai/dynamic-skills/self-improvement.md#workflow-improvement-review)
to repeated and stable procedures.

This delegation workflow still owns the worker boundary:

- semantic work uses bounded child workers;
- deterministic work uses tools;
- the active harness owns native worker coordination;
- Gizmo defines and reviews the write sequence; and
- child workers do not acquire delivery authority.

## Validation

Before continuing from a worker commit, verify:

- every worker used its declared exact baseline;
- every team worker used its declared team identity;
- every worker's activity-line context carried the current pull-request
  identity before its first user-visible activity;
- the active harness supplied the authoritative host-local clock source for
  worker communication, and every activity line used a fresh read immediately
  before emission;
- every worker activity used the compact actor token mapped from its declared
  team identity, without a personal name;
- every pull-request creation refreshed the context through the active harness
  before that worker's next user-visible activity;
- every worker-executable team or provider task recorded an explicit functional
  owner separately from team identity;
- every expertise result received semantic acceptance from its recorded
  functional owner before Gizmo continues from its commit;
- the repository task contract did not prescribe a native label or model;
- every reached worker-executable team or provider task has a task record and
  exactly one team identity;
- every parent-owned Gizmo control operation stayed outside the worker graph
  and had no worker team identity or harness-created attempt;
- every authorized `(task ID, attempt ID)` had exactly one harness-visible
  worker attempt, every logical task had at most one concurrently active
  attempt, and sequential retries used distinct attempt IDs;
- every typed immutable generation plan froze a positive finite `maxAttempts`
  before execution;
- every started attempt consumed exactly one slot and no task exceeded its
  frozen attempt bound;
- every exhausted task without accepted completion entered the hard-coded
  blocked state;
- every worker task record declares read and write resource claims;
- every repository-reading read-only task declares a non-empty repository
  evidence surface covered by its read claims;
- every evidence-only synthesis task declares empty repository read claims,
  write claims, and evidence surface plus frozen provider edges, expected
  producer identities, typed input schema, and acceptance criteria;
- every write-capable task record declares an empty evidence surface;
- every worker task records its correct frozen parent lineage and authority
  bound;
- no active leased worker attempt created another worker attempt;
- every missing dependency returned to Gizmo instead of being self-dispatched;
- every newly discovered provider entered a replacement immutable generation
  as a separate normally admitted task after old-attempt disposition;
- Gizmo's aggregate covers every terminal barrier declared by the frozen task
  lineage;
- no two write-capable attempts were active concurrently;
- every deterministically serialized write-scope overlap followed its declared
  precedence without concurrent leases;
- every write-capable attempt used the current shared checkout;
- every normal retry kept the exact frozen task contract, acceptance evidence,
  generation, and starting-frontier rule;
- every task-contract, claim, edge, or acceptance-evidence change created a new
  immutable generation instead of mutating a retry;
- every accepted commit descends from its exact baseline;
- every accepted commit changes only allowed paths;
- every downstream task binds to the exact provider commit;
- every downstream task's frontier contains its complete write-predecessor
  closure;
- read-only evidence was accepted in parent task state without a Git-ancestry
  requirement;
- declared and derived execution order was deterministic and acyclic;
- admission was stable, conflict-safe, and capped by available
  `maxConcurrency` after every unreleased lease;
- Loom/Nook computed eligible candidates, conflicts, capacity, leases, and
  exact frontier data;
- before ordinary multi-team dispatch, the installed typed validator and
  focused tests encoded and enforced the complete admission contract; otherwise
  execution failed closed before any attempt;
- Gizmo validated each computed batch, selected and admission-authorized task
  records, and froze and owned every exact starting frontier;
- the active harness created and operated attempts only for Gizmo-authorized
  records and never selected or admitted tasks or snapshotted or changed a
  frontier;
- every consumer lease included relied-on repository evidence-surface claims,
  while evidence-only synthesis admission bound exact accepted artifact,
  digest, provider, and inherited-provenance identities matching its frozen
  input contract;
- worker termination did not release a claim lease;
- every claim lease remained held until conclusive output disposition;
- accepted writes were verified and integrated before lease release;
- accepted repository-reading evidence used the verified typed handoff and
  exact repository provenance, and accepted evidence-only synthesis used the
  verified typed handoff and all attempt-bound provider-evidence input
  identities matching its frozen input contract;
- rejected or cancelled output was recorded as unusable before lease release;
- every lease release triggered Loom/Nook readiness and candidate
  recomputation;
- Gizmo froze selected frontiers before attempts were created;
- conflict-excluded ready tasks remained pending for recomputation;
- otherwise-unordered non-evidence conflicts were serialized and every writer
  overlapping a repository evidence surface preceded its repository-reading
  read-only provider;
- evidence-hazard cycles failed closed before dispatch;
- no declared evidence-provider-before-writer dependency bypassed the
  mandatory writer-before-provider constraint;
- late mutations cancelled or rejected every old-generation attempt, migrated
  no result or private state, and created fresh attempts for all authorized
  replacement-generation records; surviving same logical tasks were retries
  and newly discovered providers received first attempts;
- every cycle failed closed and reported its blocked dependency to Gizmo;
- Loom/Nook recomputed readiness and frontier data after every accepted commit
  or evidence acceptance;
- provider results were dispositioned locally without a whole-admission-batch
  barrier;
- deterministic hazard ordering prevented stale evidence in accepted
  consumers, and any late mutation that would stale accepted evidence used a
  complete generation restart without selective accepted-consumer
  invalidation or revalidation;
- no global barrier delayed dependency-ready work before the final join;
- optional JSONL and Markdown evidence did not gate harness progress;
- Gizmo reviewed all evidence;
- only Gizmo mutated delivery-head and external delivery state, and only the
  active harness owned worker-attempt lifecycle.
