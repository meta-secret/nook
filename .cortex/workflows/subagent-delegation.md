# Subagent Delegation

## Overview

- Use this workflow when a task may contain independent reasoning or
  implementation units.
- Keep one task-owning agent as the delivery owner.
- Treat child workers as bounded contributors, not independent delivery owners.

## Decision rule

A capable agent environment MUST delegate when all of these conditions hold:

1. The task contains at least two semantic work units.
2. Each work unit can start from the same immutable baseline.
3. Each work unit is read-only or has a disjoint write scope.
4. Each work unit has explicit inputs and outputs.
5. Each work unit has its own acceptance evidence.
6. The parent can define the join before workers start.

- Use an exact Git commit as the normal immutable baseline.
  - Do not use a movable branch name as a worker baseline.
- Record the delegation decision in the task plan.
- If the host has no bounded worker capability:
  - execute the work serially; and
  - do not invent an undocumented runner.

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

## Delivery owner

Exactly one agent owns delivery.

The delivery owner owns:

- Workbench planning and lifecycle records;
- architectural synthesis;
- shared-file edits;
- integration decisions;
- branch and pull-request state;
- review replies and thread resolution;
- validation requests;
- readiness and merge;
- the final completion report.

Child workers must not mutate those surfaces.

This rule preserves
[agent feature ownership](../dynamic-skills/agent-feature-ownership.md).

## Child-worker contract

Every delegated work unit must declare:

- a stable task ID;
- its exact baseline;
- its purpose;
- its allowed files or evidence surface;
- whether it is read-only;
- its dependencies;
- its expected result shape;
- its acceptance evidence;
- forbidden mutations;
- its parent-owned join.

Create one disposable worker for each reached task ID.

Do not create a second worker for the same task and attempt.

A retry is a new attempt of the same logical task.

- The worker returns a bounded result to the parent.
- The result contains:

- status;
- summary;
- evidence;
- affected paths;
- proposed changes or an isolated patch;
- risks;
- notes for the parent.

- The parent validates the result against current task state.
- The parent does not merge worker conclusions blindly.

## Module-oriented feature development

Module-oriented work follows
[module-oriented-development.md](module-oriented-development.md).

- Keep the feature dependency DAG separate from agent parent lineage.
- Use the named read-only profiles in the
  [module expert registry](../architecture/module-experts.md).
- Run module experts only through Loom's isolated non-delegating SDK runtime.
  Native child spawning inherits the delivery session's live permissions and
  is not an authorized read-only boundary.
- Invoke `internal_api_expert` when a changed contract crosses a module
  boundary.
- Freeze provider-consumer edges before implementation.
- Continue from accepted providers to immediate consumers.
- Keep shared files and lifecycle state with the delivery owner.

The hierarchy has a hard maximum depth of three.

- Depth 1 is feature synthesis or materialization.
- Depth 2 contains named module and internal API experts.
- Depth 3 is exceptional and must be declared before dispatch.
- Depth greater than three is invalid.

Children cannot freely create grandchildren.
No agent may add a task, create a new tier, or schedule a successor.
The completed depth-one parent publishes a typed `ModuleDevelopmentPlan` with
the exact task, expert, attempt, depth, and immediate-parent identity before a
named expert is invoked.
Loom replay-verifies that plan before creating the child journal.
Only this parent plan may predeclare a bounded depth-three specialist.
The immediate depth-two parent must also be completed before depth three runs.
`ModuleExpertEvidence` and `parentActions` are never scheduling authority.

## Hierarchical event protocol

Subagent work is an event-sourced hierarchy.

The mandatory information flow is:

1. An agent performs observable actions.
2. Loom records those actions in that attempt's append-only JSONL stream.
3. The agent authors a bounded Markdown semantic view from its full task
   context.
4. Loom validates, persists, and content-hashes that view.
5. The parent consumes child views and authors a higher-level aggregate view.
6. Each higher tier repeats that projection step.
7. The root delivery owner validates the root aggregate and authors the final
   user report.

The final report is the public semantic projection of the completed hierarchy.
It does not replace the run journal as lifecycle authority.

### Agent action streams

Each reached agent task attempt owns one immutable action stream.

The stream records bounded observable actions and outcomes. It never records:

- prompts;
- hidden model reasoning;
- credentials or secrets;
- raw command output;
- raw SDK errors or stack traces.

Every event carries the exact adapter, workflow, version, source commit, task,
agent, attempt, hierarchy depth, parent lineage, local sequence, and timestamp.

The current adapter-bearing attempt schema uses workflow version `2.0.0`.

- Generic delegation, named module experts, and compiled static agent tasks emit
  that version.
- Version `1.0.0` is the legacy pre-provenance schema.
- Loom rejects legacy attempt creation and replay with migration guidance.
- A disposable legacy local run must be removed before retrying.
- A retained legacy run requires an explicit trusted migration.
- A migration must not infer a missing adapter from paths, result kinds, or
  terminal content.
- Missing adapter provenance under version `2.0.0` is invalid evidence.

- Sequence is monotonic inside one stream.
- Cross-stream global ordering is not claimed.
- A retry creates a new attempt stream.
- A terminal attempt accepts no later events.
- Child streams do not decide eligibility, joins, retries, or completion.

The run-level stream remains the single local scheduling authority.

Ordinary coding delegation uses the generic Loom recording adapter when no
compiled workflow owns the dispatch. The parent declares the run identity and
lineage before dispatch. The child produces a typed record request containing
its bounded observable activities and its agent-authored semantic result. After
the child returns, the parent finalizes that request with:

```sh
task loom:agent-delegation:record REQUEST=<request.json>
```

The adapter finalizes the same `events.jsonl`, `result.json`, and `view.md`
contract used by compiled workflows. It rejects reuse of an existing attempt
directory. This gives collaboration-tool subagents a journal boundary without
making their transcript or Markdown output into scheduling authority.
The generic adapter cannot record `ModuleExpertEvidence`.
Named module experts use their isolated invocation adapter and its separately
verified authorization boundary.

The record request contains:

- the shared run identifier and exact 40-character source commit;
- the task, agent, attempt, hierarchy depth, and parent identity;
- only bounded `WorkflowRuntimeActivityKind` observations;
- one typed terminal whose task and attempt match the declared identity; and
- for completed work, the agent-authored Markdown view inside the typed output.

The child does not write canonical projections directly. Loom validates the
request and owns canonical event serialization, append order, projection
storage, and content hashes. The parent consumes only the returned projection
references and verified `view.md`.

### Semantic materialized views

An action stream is operational evidence. It does not contain enough semantic
information to reconstruct the agent's conclusions.

Therefore every completed agent must author `view.md` content in its typed
result.

- The agent owns semantic authorship because it has the complete task context.
- Loom owns schema validation, bounded persistence, hashing, and event
  references.
- Read-only agents never write the processing store directly.
- The view records its child-event high-water mark.
- Markdown is a read model. Scheduler transitions never depend on parsing it.

If an attempt fails before it can author a view, Loom writes a clearly labeled
machine-authored failure view. A parent must not represent that view as an
agent-authored conclusion.

If the declared root materializer does not complete, Loom still writes a
clearly labeled machine-authored root failure view. The delivery owner uses it
to diagnose or retry the hierarchy. It is not an agent-authored aggregate.

### Parent aggregation and continuation

A parent normally reads child semantic views and typed artifact references.

It reads raw child streams only when evidence is missing, disputed, or requires
diagnosis.

Before continuing or terminating, the parent must:

1. wait for the declared terminal barrier;
2. verify each accepted view reference and content hash;
3. reconcile child conclusions, failures, and disagreements;
4. author its own higher-level Markdown view;
5. persist that view through Loom; and
6. pass the aggregate view to the next reviewed tier.

This rule applies recursively. A root agent receives aggregate child views,
not an undifferentiated transcript of every descendant action.

The compiled graph uses an all-terminal barrier when failed lanes still contain
evidence that the parent must aggregate.

### Processing storage and retention

Local execution evidence lives under the ignored project root
`workflow/processing/`.

Path contracts are:

- `workflow/processing/<workflow>/<run-id>/events.jsonl` for run authority;
- `workflow/processing/<workflow>/<run-id>/agents/<task>/attempt-<n>/events.jsonl`
  for one agent attempt;
- `workflow/processing/<workflow>/<run-id>/agents/<task>/attempt-<n>/result.json`
  for its typed terminal projection;
- `workflow/processing/<workflow>/<run-id>/agents/<task>/attempt-<n>/view.md`
  for its semantic projection; and
- `workflow/processing/<workflow>/<run-id>/view.md` for the root aggregate.

The workflow segment is `delegated-agent-work` for ordinary coding delegation.
Each tier can be recorded as an attempt: child attempts point to their declared
parent attempt, the root aggregation attempt points to `workflow-root`, and the
delivery owner's final user report is the final public projection of that root
view.

Keep processing evidence through aggregation and handoff. Cleanup is explicit.
It is separate from disposable `.cortex/.session/` reflection memory.

## Safe delegation patterns

### Full Cortex garbage collection

A full-tree Cortex audit MUST fan out when two or more document families are in
scope.

Useful read-only partitions include:

- workflows and references;
- design docs and product specs;
- dynamic skills and entry points;
- code, Task, and CI evidence.

One parent resolves conflicting findings and authors the final edit.

A topic-local one-hop consistency check does not require fan-out.

### Structural coherence

Use the [structural refactoring workflow](structural-refactoring.md) when code
or Cortex structure is the requested maintenance surface.

- The registry contains two repository-reading structural experts.
- `system_coherence_synthesizer` receives only verified evidence.
- The delivery owner predeclares all tasks and applies accepted corrections.
- Structural roles do not delegate or create another tier.

### Broad repository inventory

Repository-wide migrations MUST use read-only workers when two or more disjoint
packages or ownership layers are in scope.

The parent owns the cross-layer interface and migration order.

Do not parallelize dependent core, WASM, and web interface changes before the
lower-layer contract is stable.

### Independent CI failures

- Two or more unrelated failed job families MUST use one diagnostic worker per
  family.
- Workers inspect exact-head evidence.
- The delivery owner:
  - correlates root causes; and
  - implements the fixes.
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
- The parent still owns integration.

## Machine-managed workflows

During reflection, apply the
[workflow improvement review](../dynamic-skills/self-improvement.md#workflow-improvement-review)
to repeated and stable procedures.

This delegation workflow still owns the worker boundary:

- semantic work uses bounded child workers;
- deterministic work uses tools;
- one delivery owner defines and reviews the join; and
- child workers do not acquire delivery authority.

The architecture boundary is defined in
[agent-workflow-orchestration.md](../design-docs/agent-workflow-orchestration.md).

## Validation

Before integration, verify:

- every worker used the same exact baseline;
- every reached task has one terminal result;
- every reached agent attempt has one continuous terminal action stream;
- every terminal attempt has an agent-authored or explicitly machine-authored
  view;
- every projection path and digest matches its recorded bytes;
- every child records the correct parent lineage;
- every attempt depth is at most three;
- no child dynamically created a task or tier;
- every parent aggregate covers the declared child terminal barrier;
- the root aggregate is the input to the delivery owner's final report;
- skipped branches are recorded;
- write scopes did not overlap;
- the parent reviewed all evidence;
- only the delivery owner mutated shared lifecycle state.
