# Agent Workflow Orchestration

## Relationships

- [Subagent Delegation](../workflows/subagent-delegation.md)
  - Defines safe parallel work and parent-agent ownership.
  - Read when the design is audited or implemented by multiple agents.

## Document map

- [Overview](#overview)
  - Status: Architecture decision with staged implementation.
  - Read before changing or relying on Overview.
- [Static graph decision](#static-graph-decision)
  - Agent workflow topology is authored as TypeScript in Loom.
  - Apply when making or reviewing decisions about Static graph decision.
- [Responsibilities](#responsibilities)
  - Defines the concrete responsibilities and constraints for Responsibilities.
  - Read before changing or relying on Responsibilities.
  - [Cortex Markdown](#cortex-markdown)
    - .cortex owns the semantic contract.
    - Read before changing or relying on Cortex Markdown.
  - [Loom static workflow module](#loom-static-workflow-module)
    - Agent workflows live in an isolated Loom.
    - Read before changing the Loom static workflow module flow or state transitions.
  - [Codex worker adapter](#codex-worker-adapter)
    - The Codex SDK is the local worker adapter.
    - Read before changing or relying on Codex worker adapter.
  - [Local journal](#local-journal)
    - A local Loom run writes an append-only event journal.
    - Read before changing or relying on Local journal.
  - [Hive](#hive)
    - Hive owns durable distributed workflow authority.
    - Read before changing or relying on Hive.
  - [Delivery owner](#delivery-owner)
    - Exactly one delivery owner remains outside the worker fan-out.
    - Read before changing or relying on Delivery owner.
- [First compiled workflow](#first-compiled-workflow)
  - The first catalog entry is cortex-full-garbage-collection.
  - Read before changing the First compiled workflow flow or state transitions.
- [Reviewed catalog growth](#reviewed-catalog-growth)
  - The catalog grows one reviewed workflow at a time.
  - Read before changing or relying on Reviewed catalog growth.
- [Adoption sequence](#adoption-sequence)
  - Define the static graph domain in the isolated Loom module. Define cortex-full-garbage-collection in TypeScript. Add graph.
  - Use while executing or reviewing Adoption sequence.
- [Non-goals](#non-goals)
  - make model output deterministic;replace Cortex policy with TypeScript;execute graphs supplied by YAML;generate graphs from.
  - Read before expanding scope or revisiting excluded behavior.
- [External evidence](#external-evidence)
  - Codex subagents documents project-instruction-triggered delegation. Codex SDK documents programmatic local Codex threads for.
  - Use before declaring External evidence complete.

## Overview

Status: Architecture decision with staged implementation.

Nook separates semantic instructions from deterministic scheduling.

- **Cortex** documents what a workflow means.
- **Loom** executes reviewed static workflow graphs.
- **Hive** owns durable distributed execution when a workflow moves onto Hive.

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

The adapter has proven:

- local ChatGPT subscription reuse without an API key;
- exact-source binding;
- cancellation;
- streamed lifecycle events;
- structured results;
- one worker per reached task attempt.

The official Codex SDK can start, continue, and resume local Codex threads.

The authentication proof used the logged-in local Codex session.

An opt-in automated integration test remains future work.

### Local journal

A local Loom run writes an append-only event journal.

The journal is the authority for that local run.

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

- **Projection authority:** Task and workflow result files are projections.
  - The journal and its content-hashed terminal projections form the local run
    record.
- **Current replay:** The replay API validates identity, sequence, and terminal
  references.
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
- **Resume:** Resume is not exposed in the first CLI slice.
  - Before adding it, a full reducer must rebuild eligibility and join state
    before scheduling new work.
- **Terminal results:** A task attempt receives one terminal result.
  - Terminal result projections are content-hashed and journal-referenced.
- **Durability boundary:** Do not treat the journal as durable distributed
  coordination.

### Hive

Hive owns durable distributed workflow authority.

Neo4j already owns:

- task readiness;
- dependency state;
- claims and leases;
- attempts;
- cancellation barriers;
- results;
- dependency artifacts.

- **Current state:** The implementation is local-only and does not enqueue Hive
  tasks.
- **Future authority:** When a Hive adapter materializes a static workflow,
  Neo4j replaces the local journal as lifecycle authority.
  - Loom's event model may map into Hive records.
  - It must not create a second authoritative scheduler beside Neo4j.
- **Execution unit:** One Hive task runs in one disposable Kata-backed Pod.
  - One Pod runs one embedded Codex thread.
  - Durable graph nodes become separate Hive tasks.
  - Nested subagents inside one Hive worker remain disabled.

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
  - The join waits for all declared arrivals.
  - The synthesis task deduplicates findings and proposes corrections.
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
10. Map selected compiled workflows onto separate Hive tasks.

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
- allow concurrent writers in one worktree;
- transfer lifecycle ownership to child workers;
- enable nested Hive workers.

## External evidence

- [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents.md)
  documents project-instruction-triggered delegation.
- [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk.md) documents
  programmatic local Codex threads for internal workflows.
