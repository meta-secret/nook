# Module-Oriented Development

## Overview

Design feature behavior top-down and implement accepted module contracts
bottom-up.

One delivery owner freezes the plan, dispatches read-only experts, writes or
integrates code, and owns the PR lifecycle.

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
- resource claims;
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
Children cannot add nodes, change edges, or schedule successors.

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

The delivery owner dispatches named experts with:

- one exact Git commit;
- a stable task and attempt identity;
- declared parent lineage and depth;
- a read-only evidence surface;
- relevant catalog entry and authority anchors;
- expected semantic result fields;
- a terminal barrier and parent-owned join.

Loom launches each expert in a separate SDK process.
The launch contract fixes read-only filesystem access, disables external
network and web search, and removes multi-agent tools.
Do not use an ordinary native child spawn from the delivery session because
that child inherits the delivery session's live permissions.

Experts return evidence and recommendations.
They do not edit files or mutate lifecycle state in this initial foundation.

Loom records each reached attempt before the parent continues.

## Bottom-up continuation

Implementation follows dependency readiness.

1. Complete the lowest provider API and its behavior-focused module tests.
2. Validate the provider against the frozen edge contract.
3. Make the accepted provider result available to its consumers.
4. Write the immediate consumer against that external API.
5. Add consumer tests for integration behavior.
6. Repeat toward the feature root.
7. Run the parent-owned join and repository delivery gates.

Independent ready providers may be analyzed in parallel.
Shared files and unresolved contracts remain serialized.

## Flat hierarchy

The hierarchy has a hard maximum depth of three.

- **Depth 1:** Feature synthesis or materialization.
- **Depth 2:** Named module and internal API experts.
- **Depth 3:** An exceptional specialist declared by the parent before dispatch.

Normal work uses depths one and two.
Depth greater than three is invalid.

An agent cannot freely create a child.
Before any named expert runs, the completed depth-one parent must publish a
typed `ModuleDevelopmentPlan` with the exact child identity in
`moduleExpertAuthorizations`.
The authorization binds task, expert, attempt, depth, and immediate parent.
Only that replay-verified parent plan may declare a depth-three task.
The depth-three immediate parent must also be completed and replay-valid.
Expert evidence and `parentActions` never authorize another task.
No task may dynamically create another tier.

Module dependency chains affect readiness.
They do not create deeper agent lineage.

## Delivery owner

Exactly one delivery owner controls:

- Workbench planning;
- graph and contract synthesis;
- implementation and shared-file edits;
- branch and PR state;
- validation and review;
- readiness, merge, and completion records.

Experts do not become delivery owners.
The registry's paths route knowledge and never grant write ownership.

## Validation

Before implementation, verify:

- every production module node has a registered expert;
- every changed boundary has a reviewed external API;
- provider tests own domain behavior;
- dependency order is acyclic;
- all task depth values are at most three;
- no child can add tasks or tiers;
- the isolated expert runtime remains read-only and non-delegating;
- the delivery owner owns the join.

Run:

```bash
task loom:module-experts:validate
task loom:verify
task loom:cortex-audit
```

## Non-goals

This foundation does not:

- enable write-capable subagents;
- allow concurrent writes in one worktree;
- define a prompt-generated graph language;
- make Markdown scheduler state;
- map local development onto Hive;
- replace Coding Bro delivery.
