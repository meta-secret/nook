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
- one registered expert;
- the consumer outcome;
- provider dependencies;
- read and write resource claims;
- read-only evidence-surface claims;
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
known graph before dispatch. Every reached node receives one team identity. A
ready selected node receives one worker attempt only after its exact starting
frontier exists.

### Wave admission

Every graph mutation runs deterministic topology and cycle validation before
dispatch. A cycle fails closed and reports the blocked dependency to Gizmo.

Every attempt leases its resource claims. A consumer lease also includes the
evidence-surface claims it relies on. Worker termination does not release the
lease. Gizmo releases it only after accepted write integration, accepted
read-only evidence, or a recorded unusable rejection or cancellation.

The harness visits ready nodes in stable task order. It excludes conflicts with
active leases, then greedily selects a maximal set whose claims do not conflict.
It snapshots all selected frontiers before creating the wave's worker attempts.

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

1. Complete the lowest provider API and its behavior-focused module tests.
2. Validate the provider against the frozen edge contract.
3. Verify the provider commit against its starting frontier and write scope.
4. Integrate accepted provider commits in deterministic task order.
5. Check affected read-only evidence surfaces after each write integration.
6. Invalidate active and terminal-but-unaccepted consumers of stale evidence.
7. Stop or cancel active consumers and reject unaccepted terminal outputs.
8. Accept read-only provider evidence into parent task state.
9. Record rejected or cancelled output as unusable.
10. Release each lease after conclusive output disposition.
11. Recompute readiness and wave selection after every lease release.
12. Rerun and reaccept stale evidence against the new consumer frontier.
13. Retry affected consumers as fresh attempts.
14. Recompute readiness after evidence acceptance or
   reacceptance.
15. Bind each ready consumer to the exact integrated frontier containing its
   complete write-predecessor closure.
16. Select the next deterministic maximal safe wave against active leases.
17. Snapshot selected frontiers and create one attempt per selected node.
18. Write each immediate consumer against the accepted external API.
19. Add consumer tests for integration behavior.
20. Repeat toward the feature root without waiting for unrelated nodes.
21. Use the all-task barrier only for the final parent-owned join.
22. Run repository delivery gates.

Independent ready providers may be analyzed in parallel.
Independent write-capable providers may run in parallel only when their
isolated workspace and resource claims are disjoint.
Shared files and unresolved contracts remain serialized.

### Provider barriers

A write provider must be terminal-successful, accepted, commit-verified, and
integrated into the consumer's Git frontier. A read-only provider must be
terminal-successful, accepted, exact-source verified, and accepted as evidence
in parent task state. Read-only evidence is not required in Git ancestry.

Provider edges are local barriers. They do not create a global wait between
waves. Ready nodes excluded by conflicts remain pending for the next readiness
recomputation.

### Evidence stability

The task record names the exact resource claims used by read-only evidence.
Before consumer dispatch, each claimed resource must have the same content
identity at the provider source commit and consumer frontier. An overlapping
write integration triggers this check. Changed evidence is invalidated, rerun
only after every active or terminal-but-unaccepted consumer attempt that relied
on it is invalidated. Active consumers stop or cancel. Completed-but-unaccepted
outputs are rejected as unusable. Evidence reruns against the new consumer
frontier and is accepted again in parent task state. Each affected consumer
retries as a fresh attempt.

For example, `nook-core` must be accepted and integrated before `nook-wasm`
starts. The web consumer then starts from the integrated frontier containing
both `nook-core` and `nook-wasm`. Independent ready module tasks continue while
that chain advances.

## Late provider discovery

The initial known module graph is frozen for dispatch.

1. A worker reports an unknown provider instead of adding the edge itself.
2. The harness invalidates and stops or cancels the affected attempt.
3. Gizmo adds the provider record and edge.
4. Gizmo recursively discovers and replans the affected module graph.
5. Gizmo reruns deterministic topology and cycle validation.
   - A cycle fails closed and reports the blocked dependency to Gizmo.
6. Unaffected tasks continue.
7. The provider satisfies its write or read-only acceptance barrier.
8. The consumer retries as a fresh attempt from a fresh exact frontier.

The invalidated attempt cannot supply accepted evidence or a commit handoff.

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

Before implementation, verify:

- every production module node has a registered expert;
- every changed boundary has a reviewed external API;
- provider tests own domain behavior;
- dependency order is acyclic;
- every task has a starting-frontier rule and declared resource scope;
- every read-only task declares its evidence-surface claims;
- every selected ready attempt has an exact starting frontier;
- every write-capable task has an isolated workspace policy;
- every task stays inside the declared hierarchy depth bound;
- no descendant widens a task or feature-DAG edge;
- every accepted writer returns a verified commit handoff;
- retries use fresh isolated attempt state;
- downstream tasks bind to the exact integrated frontier containing their full
  write-predecessor closure;
- read-only evidence is accepted in parent task state without Git ancestry;
- each wave is greedily maximal under stable task order and resource claims;
- each wave excludes claims in every unreleased lease;
- consumer leases include relied-on evidence-surface claims;
- leases persist through worker termination until conclusive output disposition;
- every lease release triggers readiness and wave recomputation;
- every graph mutation passes deterministic topology and cycle validation;
- late providers invalidate affected attempts before replanning;
- read-only evidence is head-stable for each consumer frontier;
- overlapping write integrations trigger evidence-surface checks;
- stale evidence is rerun and reaccepted against the exact consumer frontier;
- stale evidence invalidates active and terminal-but-unaccepted consumers;
- invalidated consumer outputs are recorded as unusable;
- affected consumers retry as fresh attempts;
- readiness is recomputed after integration, acceptance, or reacceptance;
- only the final parent-owned join uses an all-task barrier;
- the delivery owner owns the join.

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
