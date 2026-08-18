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

Repeated and stable graphs should become compiled Loom workflows.

- Each workflow is a fixed TypeScript definition.
- The definition owns:

- task IDs;
- dependencies;
- explicit parallel groups;
- read and write resource scopes;
- retries and timeouts;
- result schemas;
- join rules;
- skipped-task reporting.

- Do not accept workflow topology from YAML, prompts, or Cortex prose.
- Do not ask an agent to invent tasks or edges at runtime.
- Runtime input may:
  - select a reviewed catalog entry; and
  - bind the exact source commit and bounded scalar inputs.
- Runtime input must not change compiled topology.
- Do not infer parallelism from collection order.
- Execute only reachable tasks.
  - Give every declared but unreached branch an explicit skipped result.
- Use one lifecycle authority:
  - local runs use Loom's append-only event journal;
  - Hive-backed runs use Neo4j; and
  - no workflow runs two authoritative schedulers.
- The first compiled workflow is `cortex-full-garbage-collection`.
  - It contains one fixed parallel evidence wave, one join, one synthesis task,
    and the existing mechanical Cortex audit leaf.

The architecture boundary is defined in
[agent-workflow-orchestration.md](../design-docs/agent-workflow-orchestration.md).

## Validation

Before integration, verify:

- every worker used the same exact baseline;
- every reached task has one terminal result;
- skipped branches are recorded;
- write scopes did not overlap;
- the parent reviewed all evidence;
- only the delivery owner mutated shared lifecycle state.
