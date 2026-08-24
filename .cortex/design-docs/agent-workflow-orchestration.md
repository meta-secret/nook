# Agent Workflow Orchestration

## Overview

Status: Architecture decision with staged implementation.

Nook separates semantic instructions from deterministic scheduling.

- **Cortex** documents what a workflow means.
- **Loom** executes reviewed static workflow graphs.
- **Codex** supplies local bounded expert threads selected by Loom.

This design governs local software development only.
Hive is a separate product and infrastructure feature.
It does not represent, schedule, or persist local module-development work.

## Static graph decision

Agent workflow topology is authored as TypeScript in Loom.

Each workflow has a fixed, reviewed graph.

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

Hierarchy is declared by the reviewed graph.

- Every child attempt records its parent lineage.
- Every child attempt records its hierarchy depth.
- A parent may itself be a materializer below another reviewed parent.
- Each tier consumes child views and emits one higher-level semantic view.
- The delivery owner is the root outside the worker fan-out.

The hierarchy has a hard maximum depth of three.

- Depth 1 is feature synthesis or materialization.
- Depth 2 contains named module and internal API experts.
- Depth 3 is exceptional and predeclared by the reviewed parent.
- Depth greater than three is invalid.

An agent may not create an unscheduled child or choose a new graph tier from its
prompt.

The current Cortex workflow has one worker tier and one synthesis tier.
Children cannot freely create grandchildren.
No agent may dynamically add a task or another tier.

### Local feature-development boundary

Feature planning uses the
[module-oriented development workflow](../workflows/module-oriented-development.md).

- The feature dependency DAG controls readiness.
- The agent hierarchy records semantic parentage.
- Dependency chains do not increase hierarchy depth.
- Named profiles come from the
  [module expert registry](../architecture/module-experts.md).
- `internal_api_expert` owns changed inter-module and WASM consumer contracts.
- Expert catalog paths route knowledge and do not grant write authority.

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
[subagent-delegation.md](../workflows/subagent-delegation.md).

### Loom static workflow module

Agent workflows live in an isolated Loom module:

```text
agentic-ai/loom/src/agent-workflow/
```

The module boundary is one-way:

- It remains separate from Loom's domain-YAML leaf-tool runner.
- It may call existing Loom tools through typed adapters.
- Existing leaf tools do not import the workflow module.

The workflow module owns:

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

The Codex SDK is the local worker adapter.

The adapter starts one Codex thread for one reached agent task attempt.

It starts that thread in an isolated SDK process.
Constructor overrides disable agents, both multi-agent implementations, apps,
and plugins.
Thread overrides enforce read-only filesystem access, never-approve behavior,
disabled network access, and disabled web search.

Project role TOMLs name experts and provide thin instructions.
They are not capability boundaries because native children reapply the parent
turn's live permissions after role selection.
Module experts therefore cannot run as ordinary children of a write-capable
delivery session.

The adapter has proven:

- local ChatGPT subscription reuse without an API key;
- exact-source binding;
- cancellation;
- streamed lifecycle events;
- structured results;
- one worker per reached task attempt.
- no worker-owned child or successor spawning.

The official Codex SDK can start, continue, and resume local Codex threads.

The authentication proof used the logged-in local Codex session.

An opt-in automated integration test remains future work.

### Event store and materialized views

A local Loom run writes an event-sourced processing hierarchy under
`workflow/processing/`.

Ordinary collaboration-tool delegation uses the same processing hierarchy
through `task loom:agent-delegation:record REQUEST=<request.json>`. The child
produces the bounded action and semantic-result request. The parent finalizes
it through Loom, consumes the returned hashed view, and records its own
higher-level aggregation attempt. This repeats until the root attempt and the
delivery owner's final report. A compiled static graph is not required for the
per-attempt event and view contract.

The run-level `events.jsonl` journal is the scheduling authority for that local
run.

It records:

- the run ID;
- workflow name and version;
- exact source commit;
- monotonic event sequence;
- task eligibility;
- task attempts;
- runtime activity;
- task terminal results;
- successor activation;
- workflow termination.

Every reached agent attempt also has its own append-only `events.jsonl` stream.

- The child stream owns that attempt's observable action history.
- It carries explicit parent lineage.
- It does not own scheduling, joins, retries, or workflow completion.
- A retry receives a new attempt directory and stream.

Each completed agent authors a Markdown semantic materialized view as part of
its typed terminal result.

Loom validates and atomically persists that content as `view.md`.

- The agent owns the view's conclusions.
- Loom owns persistence, content hashes, event references, and source identity.
- A failed attempt receives a clearly labeled Loom-authored failure view.
- A run whose declared materializer does not complete receives a clearly
  labeled Loom-authored root failure view.
- Markdown is never parsed to decide workflow state.

Parents consume child views by default and raw child streams only for
diagnosis. A declared materializer agent reconciles child views and authors the
next aggregate view. This repeats through every reviewed graph tier until the
root aggregate is available to the delivery owner.

The root delivery owner validates that aggregate against current state and
authors the final user report. That report is the public semantic projection of
the hierarchy. It does not become scheduling authority.

- **Projection authority:** Task and workflow result files are projections.
  - Agent result JSON, agent view Markdown, the root result, and the root view
    are content-hashed projections.
  - Root task-terminal events reference finalized child streams and views.
- **Current replay:** The replay API validates identity, sequence, terminal
  references, canonical projection paths and hashes, referenced agent streams,
  result equivalence, lineage, and view authorship.
  - It does not yet rebuild scheduler eligibility or join state.

Journal events are bounded and secret-sanitized. They must not contain:

- prompts;
- model reasoning;
- credentials;
- repository secrets;
- raw command output.

- **Error records:** Runtime adapters normalize errors before appending events.
  - An event records a bounded category and sanitized detail.
  - It never serializes a raw SDK error, stack trace, or command failure object.
- **Event identity:** Every event carries the workflow version and exact source
  commit. Sequence numbers increase without gaps within one run.
- **Attempt schema compatibility:** Adapter-bearing attempt streams use workflow
  version `2.0.0`.
  - Version `1.0.0` is rejected as legacy.
  - Loom does not infer missing adapter provenance during replay or migration.
  - The exact cleanup and migration policy is owned by
    [Subagent Delegation](../workflows/subagent-delegation.md#agent-action-streams).
- **Resume:** Resume is not exposed in the first CLI slice.
  - Before adding it, a full reducer must rebuild eligibility and join state
    before scheduling new work.
- **Terminal results:** A task attempt receives one terminal result.
  - A successful agent attempt is not terminal until its result, action stream,
    and semantic view are finalized and journal-referenced.
- **Durability boundary:** Do not treat the journal as durable distributed
  coordination.

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

Workers return evidence or isolated patches.

They do not become delivery owners.

## First compiled workflow

The first catalog entry has this contract:

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
  - The delivery owner reviews the report and authors any later correction.

## Reviewed catalog growth

The catalog grows one reviewed workflow at a time.

The next candidates are:

1. the fixed Coding Bro delivery state machine;
2. fixed exact-head CI diagnosis lanes;
3. fixed dependency inventory lanes.

Do not add a generic workflow builder.

Do not add prompt-defined task cardinality.

Do not create a general graph language outside TypeScript.

## Adoption sequence

1. Define the static graph domain in the isolated Loom module.
2. Define `cortex-full-garbage-collection` in TypeScript.
3. Add graph validation and a dry-run projection.
4. Add the append-only local journal and typed terminal projections.
5. Add deterministic ready-wave execution.
6. Add the Codex SDK adapter after auth and cancellation proof.
7. Execute the read-only Cortex workflow.
8. Delete Lace and remove it from the Minds workspace.
9. Add the fixed Coding Bro delivery workflow.
10. Add reviewed module-oriented workflows only after their read-only expert
    contracts and depth bounds are proven.

Write-capable worker execution is not the starting point.

The first implementation rejects write-capable Codex worker profiles.

It begins only after the read-only workflow proves:

- baseline binding;
- resource enforcement;
- complete terminal results;
- journal replay;
- cancellation;
- parent-owned integration.

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
- allow a child to create an unscheduled agent tier.

## External evidence

- [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents.md)
  documents project-instruction-triggered delegation.
- [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk.md) documents
  programmatic local Codex threads for internal workflows.
