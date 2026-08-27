# Agent Workflow Orchestration

## Overview

Status: Architecture decision with staged implementation.

Nook separates repository policy from native harness coordination.

- **Cortex** documents what a workflow means.
- **Codex, Cursor, or another capable harness** creates and coordinates native
  subagents.
- **Loom** may execute reviewed static read-only workflow graphs.
- **Nook tools** validate task contracts, isolated workspace handoffs, and
  deterministic integration evidence.

This design governs local software development only.
Hive is a separate product and infrastructure feature.
It does not represent, schedule, or persist local module-development work.

## Static graph decision

This decision applies only to workflows compiled into Loom.
Native harness delegation does not require a Loom graph.

Each compiled Loom workflow has a fixed, reviewed graph.

The compiled definition owns:

- stable task IDs;
- dependency edges;
- explicit parallel targets;
- joins;
- read and write resource claims;
- timeouts;
- result types;
- terminal transitions.

Loom must not:

- parse Cortex prose into a graph;
- accept a workflow graph from YAML;
- ask an agent to invent a graph;
- add tasks from prompt contents;
- infer parallelism from collection order.

Runtime inputs have bounded authority:

- They may select a compiled workflow.
- They may bind its exact source commit and other scalar inputs.
- They cannot change its topology.
- A conditional path uses a declared edge in the compiled graph.
- An unused declared path receives an explicit skipped result.

### Hierarchy semantics

The active harness owns native subagent hierarchy.

- Every delegated task declares parent lineage.
- Every task declares a hierarchy depth bound.
- A child may delegate only inside its assigned task and ownership scope.
- Descendants inherit the exact baseline and delivery owner.
- The harness owns communication, scheduling, retries, cancellation, barriers,
  nested delegation, and synthesis.

A compiled Loom graph still declares its own fixed hierarchy.
That hierarchy is an optional separate workflow.
It does not constrain capable native harness delegation beyond the repository's
task contract and ownership rules.

### Local feature-development boundary

Feature planning uses the
[module-oriented development workflow](../../../gizmo/workflows/module-oriented-development.md).

- The feature dependency DAG controls readiness.
- The agent hierarchy records semantic parentage.
- Dependency chains do not increase hierarchy depth.
- Named profiles come from the
  [module expert registry](../architecture/module-experts.md).
- `internal_api_expert` owns changed inter-module and WASM consumer contracts.
- Expert catalog paths route knowledge and do not grant write authority.
- Write-capable nodes use isolated workspaces and verified commit handoffs.
- Downstream nodes bind to the exact integrated provider commit.

## Responsibilities

### Cortex Markdown

`.cortex` owns the semantic contract.

It defines:

- when delegation is required;
- why a worker exists;
- worker inputs and outputs;
- read and write ownership;
- security boundaries;
- acceptance evidence;
- delivery-owner responsibility.

Markdown does not schedule workers.

The canonical decision contract is
[subagent delegation](../../../gizmo/workflows/subagent-delegation.md).

### Loom static workflow module

Optional compiled agent workflows live in an isolated Loom module:

```text
agentic-ai/loom/src/agent-workflow/
```

The module boundary is one-way:

- It remains separate from Loom's domain-YAML leaf-tool runner.
- It may call existing Loom tools through typed adapters.
- Existing leaf tools do not import the workflow module.

For those compiled workflows, the module owns:

- the compiled workflow catalog;
- graph validation;
- deterministic ready-wave scheduling;
- one disposable worker per reached task attempt;
- typed result and artifact handoff;
- resource-conflict checks;
- append-only workflow events;
- terminal projections;
- timeout and cancellation state.

- **Retries:** Retries are not implicit. A workflow that needs them must declare
  and test that policy explicitly.
- **CLI:** A separate `loom-agent-workflow` CLI invokes the static catalog.
  - It accepts a workflow name and bounded runtime inputs.
  - It does not accept a graph document.

The repository Task wrapper is the canonical entrypoint:

```bash
task loom:agent-workflow:cortex-audit BASELINE=<40-character-commit-sha>
```

- The repository Task wrapper is the canonical entrypoint.
- The bare `loom-agent-workflow` binary is an internal package entrypoint.

### Codex worker adapter

The active Codex, Cursor, or other capable harness is the primary worker
adapter.

It owns:

- native subagent creation and communication;
- Gizmo-model inheritance for every native subagent;
- dependency-ready scheduling and barriers;
- retry and cancellation behavior;
- nested delegation within declared depth and ownership bounds;
- child-result synthesis;
- context transfer to downstream tasks.

Nook does not start another Codex or Cursor process to coordinate those native
subagents.

Project role TOMLs remain thin routing instructions.

The canonical write-capable team types are:

- `ai_team_agent`;
- `development_core_team_agent`;
- `security_team_agent`;
- `sre_team_agent`; and
- `web_development_team_agent`.

Their profiles enforce these boundaries:

- The parent task contract supplies identity, baseline, scope, dependencies,
  evidence, hierarchy depth, and the join.
- The agent loads its own team `AGENTS.md`, knowledge graph, and minimal
  task-relevant authorities.
- Foreign-team requirements return to the parent.
- Write-capable agents use isolated workspaces and return commit handoffs.
- Profiles do not grant lifecycle authority.
- Profiles do not set `model` or `model_reasoning_effort`.

The existing Loom Codex SDK adapter remains available for reviewed static
read-only workflows.
It is not required for module-expert dispatch or module-DAG implementation.

### Event store and materialized views

A compiled Loom run may write an event-sourced processing hierarchy under
`workflow/processing/`.

That evidence is optional for native harness delegation.
Native harness scheduling does not depend on repository JSONL files, result
files, content hashes, or Markdown summaries.

These artifacts may remain useful to humans:

- JSONL streams preserve bounded observable activity for an audit.
- Typed result files preserve machine-readable evidence.
- Markdown views preserve agent-authored conclusions for review.
- Root views preserve a human-readable synthesis.

Optional evidence must exclude prompts, hidden reasoning, credentials,
secrets, raw command output, and raw errors.

No optional artifact may gate:

- dispatch;
- continuation;
- retries;
- cancellation;
- dependency joins;
- nested delegation;
- synthesis;
- completion.

The active harness remains the coordination authority.
The delivery owner validates accepted commits and evidence against current
repository state before integration.

### Delivery owner

Exactly one delivery owner remains outside the worker fan-out.

That owner controls:

- architectural synthesis;
- shared-file edits;
- Workbench state;
- branch and pull-request state;
- review replies and resolution;
- validation requests;
- readiness and merge.

Read-only workers return evidence. Write-capable workers return verified commit
handoffs from their isolated workspaces.

They do not become delivery owners.

## First compiled workflow

The first optional catalog entry has this contract:

- Name: `cortex-full-garbage-collection`.
- Capability: read-only.
- Topology owner: fixed TypeScript.

The workflow contains:

1. `resolve-baseline`;
2. one parallel audit wave;
3. `evidence-collected` join;
4. `synthesize-findings`.

The parallel wave contains these tasks:

- `audit-workflows-and-references`;
- `audit-design-docs-and-product-specs`;
- `audit-dynamic-skills-and-entry-points`;
- `audit-runtime-task-and-ci`;
- `mechanical-cortex-audit`.

- **Source binding:** Every audit task uses the same exact source commit.
  - Loom verifies that exact `HEAD` and a clean worktree before and after every
    Codex attempt.
  - The cleanliness check includes untracked files.
- **Evidence flow:** Every task returns typed evidence.
  - The all-terminal join waits for every declared arrival, including failed
    evidence lanes.
  - Every lane exposes a Markdown view to synthesis.
  - The synthesis task deduplicates findings and authors the root aggregate
    view.
  - Workflow findings distinguish semantic policy, deterministic leaves,
    bounded agent tasks, compiled graph candidates, delivery-owner actions, and
    ephemeral guidance.
  - The mechanical leaf reuses Loom's existing Cortex audit and reaches the
    same join before synthesis.
- **Mutation boundary:** The workflow edits no repository file and mutates no
  GitHub or Workbench state.
  - Gizmo reviews the report and assigns any later correction to the
    responsible team subagent.

## Reviewed catalog growth

The optional catalog grows one reviewed workflow at a time.
Use it only when a static deterministic graph is independently useful.

Native Coding Bro delivery and module-DAG implementation remain harness-owned.
They do not require compiled Loom workflows.

The optional Loom catalog keeps these boundaries:

- Do not add a generic workflow builder.
- Do not add prompt-defined task cardinality.
- Do not create a general graph language outside TypeScript.

## Adoption sequence

The static Loom workflow foundation is complete and remains available for
bounded read-only audits.

Harness-native module delivery proceeds separately:

1. Validate a frozen module DAG and task contracts.
2. Prepare one isolated workspace for each ready write-capable task.
3. Let the active harness coordinate subagents.
4. Verify each returned commit against its baseline and write scope.
5. Integrate accepted commits in deterministic dependency order.
6. Bind consumers to the exact integrated provider commit.
7. Give retries fresh isolated state.
8. Prove the full provider-to-consumer path with focused tests.

Optional journals and views may document the run for humans.
They do not participate in the control path.

## Non-goals

This decision does not:

- make model output deterministic;
- replace Cortex policy with TypeScript;
- execute graphs supplied by YAML;
- generate graphs from prompts or Markdown;
- make Loom a durable distributed task store;
- map local software development onto Hive;
- allow concurrent writers in one worktree;
- transfer lifecycle ownership to child workers;
- let nested delegation widen a frozen task or ownership scope;
- require Loom to coordinate native harness subagents;
- require JSONL or Markdown artifacts for workflow progress.

## External evidence

- [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents.md)
  documents project-instruction-triggered delegation.
- [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk.md) documents
  programmatic local Codex threads for internal workflows.
