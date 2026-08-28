# Module-Oriented Development

## Overview

Design feature behavior top-down and implement accepted module contracts
bottom-up.

One delivery owner freezes the plan and owns the PR lifecycle.
Worker dispatch follows the root
[team worker contract](../../AGENTS.md#team-worker-contract) and
[subagent delegation](subagent-delegation.md).

Named experts come from the
[module expert registry](../../teams/ai/architecture/module-experts.md).
Universal worker safety comes from
[subagent delegation](subagent-delegation.md).

## Feature module DAG

A feature module DAG is a plan for one feature or PR slice.
It is not the agent parent-lineage tree.

Each node declares:

- a stable task ID;
- exactly one team identity;
- one registered expert;
- the consumer outcome;
- provider dependencies;
- read and write resource claims;
- a non-empty read-only evidence surface covered by its read claims;
- the starting-frontier rule;
- the isolated workspace policy for write-capable work;
- the expected commit handoff;
- acceptance evidence;
- the parent-owned join.

Each edge declares:

- provider and consumer;
- the smallest observable capability;
- public types and errors;
- behavior and security invariants;
- compatibility expectations;
- owning contract tests.

The delivery owner recursively discovers task records and freezes the initial
known graph before dispatch. Team identity selects context and semantic
acceptance ownership. The registered expert selects bounded module knowledge
and never substitutes for team identity. A ready selected node receives one
worker attempt only after its exact starting frontier exists.

### Execution graph and admission

The validator augments declared provider edges with deterministic execution
constraints before dispatch.

- Every writer that overlaps a read-only evidence surface is ordered before
  that evidence provider, regardless of their existing declared order.
- Other otherwise-unordered conflicting nodes are serialized in stable
  execution order instead of rejected.
- An existing provider dependency that requires evidence before an overlapping
  writer conflicts with the mandatory writer-before-provider constraint. The
  resulting cycle fails closed before dispatch and reports the blocked
  dependency to Gizmo.

Every attempt leases its resource claims. A consumer lease also includes the
evidence-surface claims it relies on. Worker termination does not release the
lease. Gizmo releases it only after accepted write integration, accepted
read-only evidence, or a recorded unusable rejection or cancellation.

The harness computes capacity as
`max(0, maxConcurrency - unreleasedLeaseCount)`.
It visits ready nodes in stable task order, excludes conflicts with unreleased
leases, and greedily selects a maximal admission batch only up to that capacity.
It snapshots all selected frontiers before creating the batch's worker
attempts. An admission batch is not a completion or integration barrier.

- A child may delegate only within its assigned node and declared depth bound.
- Nested delegation cannot add graph nodes, change edges, or widen write scope.

## Contract-first planning

Plan from the feature outcome toward its lowest providers.

1. State the user or consumer outcome.
2. Identify the consuming module.
3. Walk dependencies down to the lowest provider that must change.
4. Invoke `internal_api_expert` for every changed module boundary.
5. Ask each provider expert to review the smallest external API.
6. Record typed inputs, outputs, errors, invariants, and owning tests.
7. Freeze the module order and the PR cut.

Do not invent speculative APIs for hypothetical consumers.
Do not begin consumer code while its provider contract remains unresolved.

## Expert dispatch

The module task adds these expert-specific inputs to the universal worker
contract:

- one stable semantic expert role;
- the task's mandatory and separate team identity;
- a read-only evidence surface;
- task-selected authority anchors and skills; and
- expected module evidence fields.

Experts return evidence and recommendations.
Read-only experts do not edit files or mutate lifecycle state.
An implementation worker receives a separate write contract and isolated
workspace.

Optional Loom journals and Markdown views may preserve human-readable audit
evidence. They never gate harness continuation.

## Bottom-up continuation

Implementation follows dependency readiness.

1. Complete and test the lowest provider against its frozen edge contract.
2. Verify and integrate an accepted write provider immediately.
3. Verify and accept read-only evidence through its versioned typed handoff.
4. Record unusable output, then release its lease and recompute admission.
5. Bind each ready consumer to its complete write-predecessor frontier.
6. Continue provider-locally toward the feature root while unrelated work runs.
7. Use the all-task barrier only for the final parent-owned join, then run
   repository delivery gates.

Independent ready providers may be analyzed in parallel.
Independent write-capable providers may run in parallel only when their
isolated workspace and resource claims are disjoint.
Shared files and unresolved contracts remain serialized.

### Provider barriers

A write provider must be terminal-successful, accepted, commit-verified, and
integrated into the consumer's Git frontier. A read-only provider must be
terminal-successful, accepted, exact-source verified, and accepted as evidence
in parent task state. Read-only evidence is not required in Git ancestry.

Provider edges are local barriers. A provider is dispositioned and integrated
alone as soon as it is accepted; unrelated members of its admission batch do
not delay its consumers. Ready nodes excluded by conflict or capacity remain
pending for the next readiness recomputation.

### Evidence handoff and hazard ordering

The task record names the exact non-empty subset of read claims used to produce
read-only evidence. Its typed handoff records a content identity for every
evidence-surface claim and binds the result to one immutable plan generation,
team, task, attempt, exact source commit, and evidence artifact digest.

Every overlapping writer is a mandatory derived predecessor of the evidence
provider, even when the declared graph already puts that writer downstream of
the provider or one of its consumers. Evidence therefore runs only after those
writes are integrated, and its consumers run only after the handoff is verified
and accepted. If an existing provider path requires evidence before the writer,
the combined graph is cyclic and validation rejects the plan before dispatch.
The plan must remove the overlap or repair the dependencies; ordinary execution
does not accept stale consumers and then selectively revalidate them. The
active harness retains scheduling, cancellation, retry, and lifecycle
authority.

For example, `nook-core` must be accepted and integrated before `nook-wasm`
starts. The web consumer then starts from the integrated frontier containing
both `nook-core` and `nook-wasm`. Independent ready module tasks continue while
that chain advances.

## Late provider discovery and generation restart

The initial graph is frozen. A worker reports an unknown provider to Gizmo;
every late mutation then uses the complete
[immutable generation restart](subagent-delegation.md#immutable-generation-restart).
All old-generation attempts are cancelled or rejected, accepted evidence and
private integration state are abandoned, and every reached task retries fresh
from the replacement generation's declared source and exact frontier. No old
output migrates.

## Flat hierarchy

The plan declares a task-specific hierarchy depth bound.

- The harness enforces the bound for native subagent delegation.
- A child may create a descendant only inside its assigned task contract.
- A descendant inherits its task's starting frontier, ownership limits, and delivery
  owner.
- Nested delegation cannot authorize another feature-DAG node.
- Nested delegation cannot acquire GitHub, Workbench, shared-file, or merge
  authority.

Module dependency chains affect readiness.
They do not create deeper agent lineage.

## Delivery owner

Exactly one delivery owner controls:

- Workbench planning;
- graph and contract synthesis;
- shared-file edits and commit integration;
- branch and PR state;
- validation and review;
- readiness, merge, and completion records.

Experts do not become delivery owners.
The registry's paths route knowledge and never grant write ownership.
Write-capable workers own only the paths and workspace named by their task.

## Validation

Before implementation, verify the canonical
[delegation validation](subagent-delegation.md#validation) and
these module-specific requirements:

- every node has one team identity separate from a registered expert;
- every changed boundary has a reviewed external API and provider-owned tests;
- every task has exact frontier, scope, isolation, and hierarchy rules;
- every read-only task has a read-covered evidence surface and typed handoff;
- every successor receives its complete write-predecessor closure; and
- only the delivery owner performs the final all-task join.

Run:

```bash
task loom:module-delivery:validate PLAN=path/to/plan.json
task loom:module-experts:validate
task loom:verify
task loom:cortex-audit
```

## Non-goals

This foundation does not:

- allow concurrent writes in one worktree;
- define a prompt-generated graph language;
- make Markdown scheduler state;
- require JSONL or Markdown evidence for harness progress;
- replace native harness subagent coordination;
- map local development onto Hive;
- replace Gizmo mission delivery.
