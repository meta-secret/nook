# Subagent Delegation

## Overview

- Use this workflow when different subagents can complete separate tasks.
- Keep Gizmo as the delivery owner.
- Team subagents implement their assigned tasks. They do not control delivery.

## Decision rule

A capable agent environment MUST delegate when all of these conditions hold:

1. The request contains at least two separate team tasks.
2. Each subagent can start from the same exact Git commit.
3. Each subagent is read-only or changes different files.
4. Each subagent has explicit inputs and expected outputs.
5. Each subagent has its own acceptance evidence.
6. Gizmo can state how the returned results will be integrated before work
   starts.

- Use an exact Git commit as the normal immutable baseline.
  - Do not use a movable branch name as a worker baseline.
- Record the delegation decision in the task plan.
- Preserve Gizmo's exact model for every native subagent.
  - Do not set a different model in the spawn request.
  - Do not set `model` in a custom agent file.
  - Do not use an `[agents]` default that changes the model.
  - Pass Gizmo's exact model when the harness does not inherit it
    automatically.
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
- Gizmo's model;
- its exact baseline;
- its purpose;
- its allowed files or evidence surface;
- whether it is read-only;
- its dependencies;
- its hierarchy depth bound;
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
- proposed changes or a verified commit handoff;
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

- Assign each task to `ai`, `dev-core`, `security`, `sre`, or `web-dev` before
  starting subagents.
- Give every team agent one team identity and explicit code and Cortex paths.
- Give every team agent Gizmo's exact model.
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
7. binds downstream work to the exact integrated commit.

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

Use the [structural refactoring workflow](structural-refactoring.md) when code
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

Do not parallelize dependent core, WASM, and web interface changes before the
lower-layer contract is stable.

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
[workflow improvement review](../dynamic-skills/self-improvement.md#workflow-improvement-review)
to repeated and stable procedures.

This delegation workflow still owns the worker boundary:

- semantic work uses bounded child workers;
- deterministic work uses tools;
- the active harness owns native worker coordination;
- Gizmo defines and reviews the integration; and
- child workers do not acquire delivery authority.

The architecture boundary is defined in
[agent-workflow-orchestration.md](../design-docs/agent-workflow-orchestration.md).

## Validation

Before integration, verify:

- every worker used its declared exact baseline;
- every reached task has a harness-visible terminal result;
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
- integration follows deterministic dependency order;
- optional JSONL and Markdown evidence did not gate harness progress;
- the parent reviewed all evidence;
- only Gizmo mutated shared lifecycle state.
