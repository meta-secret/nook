# Module-Oriented Development

## Overview

Design feature behavior top-down and implement accepted module contracts
bottom-up.

One delivery owner freezes the plan and owns the PR lifecycle.
The active harness dispatches experts and implementation workers.
Write-capable workers use isolated workspaces and return commit handoffs.

Named experts come from the
[module expert registry](../architecture/module-experts.md).
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
- one exact baseline;
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

The delivery owner freezes these relationships before implementation begins.
The harness schedules ready nodes from the frozen dependency order.
A child may delegate only within its assigned node and declared depth bound.
Nested delegation cannot add graph nodes, change edges, or widen write scope.

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

The active Codex, Cursor, or other capable harness dispatches named experts
with:

- one exact Git commit;
- a stable task identity;
- declared parent lineage and depth bound;
- a read-only evidence surface;
- relevant catalog entry and authority anchors;
- expected semantic result fields;
- a terminal barrier and parent-owned join.

The harness owns expert creation, communication, scheduling, retries,
cancellation, barriers, nested delegation, and synthesis.
The repository does not start a second Codex or Cursor process to coordinate
native subagents.

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
3. Verify the provider commit against its baseline and write scope.
4. Integrate accepted provider commits in deterministic task order.
5. Bind immediate consumers to the exact integrated commit.
6. Write the immediate consumer against the accepted external API.
7. Add consumer tests for integration behavior.
8. Repeat toward the feature root.
9. Run the parent-owned join and repository delivery gates.

Independent ready providers may be analyzed in parallel.
Independent write-capable providers may run in parallel only when their
isolated workspace and resource claims are disjoint.
Shared files and unresolved contracts remain serialized.

## Flat hierarchy

The plan declares a task-specific hierarchy depth bound.

- The harness enforces the bound for native subagent delegation.
- A child may create a descendant only inside its assigned task contract.
- A descendant inherits the same baseline, ownership limits, and delivery
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
- every task has an exact baseline and declared resource scope;
- every write-capable task has an isolated workspace policy;
- every task stays inside the declared hierarchy depth bound;
- no descendant widens a task or feature-DAG edge;
- every accepted writer returns a verified commit handoff;
- retries use fresh isolated attempt state;
- downstream tasks bind to the exact integrated commit;
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
- replace Coding Bro delivery.
