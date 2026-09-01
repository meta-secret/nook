# Module-Oriented Development

## Overview

Design feature behavior top-down and implement accepted module contracts
bottom-up.

One delivery owner freezes the plan and owns delivery-head PR and Workbench state.
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
- whether it is read-only or write-capable;
- exactly one team identity;
- an explicit functional owner;
- one registered expert;
- the consumer outcome;
- provider dependencies;
- read and write resource claims;
- an evidence surface:
  - a repository-reading read-only node declares the exact non-empty subset of
    its read claims used to produce evidence; and
  - a write-capable node declares an empty evidence surface;
- the starting-frontier rule;
- the shared-checkout policy for write-capable work;
- whether Gizmo requests a commit;
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
known graph before dispatch. Team identity selects only team context. The
explicit functional owner controls semantic acceptance; for an expertise node,
that owner accepts the expertise-provider team's result before Gizmo
integration. The registered expert selects bounded module knowledge and never
substitutes for either field. Each authorized `(task ID, attempt ID)` receives
exactly one harness-visible worker attempt only after its exact starting
frontier exists. A logical node may retry sequentially but never has more than
one concurrently active attempt.

### Executable enforcement gate

The universal
[executable enforcement gate](subagent-delegation.md#executable-enforcement-gate)
applies here and to every ordinary multi-team delegation path. The currently
installed validator does not enforce the complete canonical admission contract,
so this module-delivery path fails closed before dispatch. Its narrower schema
or tests cannot authorize this path. Markdown policy and manual review cannot
substitute for the missing typed runtime.

### Execution graph and admission

The validator augments declared provider edges with deterministic execution
constraints before dispatch.

- Every writer that overlaps a repository-reading read-only evidence surface is
  ordered before that evidence provider, regardless of their existing declared
  order.
- Other otherwise-unordered conflicting nodes are serialized in stable
  execution order instead of rejected.
- An existing provider dependency that requires evidence before an overlapping
  writer conflicts with the mandatory writer-before-provider constraint. The
  resulting cycle fails closed before dispatch and reports the blocked
  dependency to Gizmo.

Every attempt leases its resource claims. A consumer lease also includes the
evidence-surface claims it relies on. Worker termination does not release the
lease. Gizmo records a conclusive disposition after accepted write integration,
accepted read-only evidence, or unusable rejection or cancellation; only then
does Loom/Nook release the lease.

Loom/Nook computes eligible candidates, conflicts, leases, exact frontier data,
and capacity as
`max(0, maxConcurrency - unreleasedLeaseCount)`.
It visits ready nodes in stable task order, excludes conflicts with unreleased
leases, and computes a maximal safe candidate batch only up to that capacity.
Gizmo validates the batch, selects task records, admission-authorizes one exact
attempt ID per selection, and freezes and owns those attempts' exact starting
frontiers before supplying contracts to the active harness. The harness only
creates and operates the authorized worker
attempts; it does not select or admit records or snapshot or change frontiers.
An admission batch is not a completion or integration barrier.

- A worker attempt holding a claim lease cannot create another worker attempt.
- Frozen parent lineage and authority bounds do not grant self-dispatch.

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
- for a repository-reading read-only expert task, a non-empty evidence surface
  covered by its read claims;
- for a write-capable implementation task, an empty evidence surface;
- task-selected authority anchors and skills; and
- expected module evidence fields.

Experts return evidence and recommendations.
Read-only experts do not edit files or mutate lifecycle state.
An implementation worker receives a separate write contract and the current
shared checkout.

Optional Loom journals and Markdown views may preserve human-readable audit
evidence. They never gate harness continuation.

## Bottom-up continuation

Implementation follows dependency readiness.

1. Complete and test the lowest provider against its frozen edge contract.
2. Verify an accepted write provider and continue from its commit immediately.
3. Verify and accept read-only evidence through its versioned typed handoff.
4. Record unusable output, then let Loom/Nook release its lease and recompute
   candidates.
5. Validate the computed successor and freeze its complete
   write-predecessor frontier before admission authorization.
6. Continue provider-locally toward the feature root while unrelated work runs.
7. Use the all-task barrier only for the final parent-owned join, then run
   repository delivery gates.

Independent ready providers may be analyzed in parallel.
Write-capable providers run sequentially in the shared checkout.
Independent read-only providers may run in parallel when their evidence scopes
are safe.
Shared files and unresolved contracts remain serialized.

### Provider barriers

A write provider must be terminal-successful, accepted, and commit-verified.
Its commit becomes the consumer's shared-branch starting point. A read-only provider must be
terminal-successful, accepted, exact-source verified, and accepted as evidence
in parent task state. Read-only evidence is not required in Git ancestry.

Provider edges are local barriers. Gizmo dispositions a provider and continues
from its commit as soon as it is accepted. Unrelated members of its admission batch do
not delay its consumers. Ready nodes excluded by conflict or capacity remain
pending for the next readiness recomputation.

### Evidence handoff and hazard ordering

The task record names the exact non-empty subset of read claims used to produce
read-only evidence. Its typed handoff records a content identity for every
evidence-surface claim and binds the result to one immutable plan generation,
team, task, attempt, exact source commit, and evidence artifact digest.

Every overlapping writer is a mandatory derived predecessor of the evidence
provider. This applies even when the declared graph puts that writer downstream
of the provider or a consumer. Evidence runs only after those writes are
accepted. Its consumers run only after the direct commit is verified. If a
provider path requires evidence before the writer, the combined graph is
cyclic. Validation rejects that plan before dispatch.
The plan must remove the overlap or repair the dependencies; ordinary execution
does not accept stale consumers and then selectively revalidate them. The
active harness retains only authorized attempt creation, start, run,
communication, retry, cancellation, and lifecycle authority.

For example, `nook-core` must commit before `nook-wasm` starts. The web consumer
then starts from the shared-branch commit containing both modules. Independent
ready module tasks continue while that chain advances.

## Late provider discovery and generation restart

The initial graph is frozen. A worker reports an unknown provider to Gizmo and
does not dispatch it. Gizmo conclusively dispositions the old attempt; every
late mutation then uses the complete
[immutable generation restart](subagent-delegation.md#immutable-generation-restart).
All old-generation attempts are cancelled or rejected, accepted evidence and
private admission state are abandoned. Every authorized replacement-
generation record receives a fresh attempt from its declared source and exact
frontier. A surviving same logical task receives a retry; the new provider is a
separate task with its own team identity, functional owner, resources, and
first attempt. After old-generation disposition, Loom/Nook computes candidacy
and frontiers. Gizmo validates and admission-authorizes the records. It freezes
their frontiers before the harness creates those attempts. No old output
migrates.

## Flat hierarchy

The plan declares a task-specific hierarchy depth bound.

- The frozen task graph records parent lineage and bounded authority.
- Lineage supports validation and aggregation; it grants no worker-creation
  authority.
- No active leased attempt may create a descendant or any other attempt.
- Only Gizmo admission-authorizes records from a validated immutable
  generation and freezes their frontiers. The harness only creates their
  authorized attempts.

Module dependency chains affect readiness.
They do not create deeper agent lineage.

## Delivery owner

Exactly one delivery owner controls:

- Workbench planning;
- graph and contract synthesis;
- shared-file serialization, exact writer grants, and write sequencing;
- branch and PR state;
- validation and review;
- readiness, merge, and completion records.

Experts do not become delivery owners.
The registry's paths route knowledge and never grant write ownership.
Write-capable workers own only the paths named by their task.

## Validation

Before implementation, verify the canonical
[delegation validation](subagent-delegation.md#validation) and
these module-specific requirements:

- the executable enforcement gate above passed before dispatch;
- every node has one team identity, one explicit functional owner, and a
  separate registered expert;
- every expertise result is accepted by its functional owner before Gizmo
  integration;
- every changed boundary has a reviewed external API and provider-owned tests;
- every task has exact frontier, scope, shared-checkout, and frozen lineage
  rules;
- every repository-reading read-only task has a non-empty read-covered evidence
  surface and typed handoff;
- every write-capable task has an empty evidence surface;
- every authorized `(task ID, attempt ID)` had exactly one harness-visible
  worker attempt and no logical task had concurrent active attempts;
- every successor receives its complete write-predecessor closure; and
- only the delivery owner performs the final all-task join.

Only after the executable enforcement gate passes, run:

```bash
task loom:module-delivery:validate PLAN=path/to/plan.json
task loom:module-experts:validate
task loom:verify
task loom:cortex-audit
```

`task loom:module-delivery:validate` proves compliance only when the installed
validator schema encodes and enforces the complete gate above. A result from an
incompatible schema proves only that narrower schema and cannot authorize this
path.

## Non-goals

This foundation does not:

- allow concurrent write-capable Team Agents;
- define a prompt-generated graph language;
- make Markdown scheduler state;
- require JSONL or Markdown evidence for harness progress;
- replace native harness subagent coordination;
- map local development onto Hive;
- replace Gizmo mission delivery.
