# Agent Workflow Orchestration

Status: Architecture decision with staged implementation.

Nook separates semantic instructions from deterministic scheduling.

Markdown and an agent runtime solve different problems.

They are complementary.

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
- parent integration responsibility.

Markdown does not schedule workers.

The canonical decision contract is
[subagent-delegation.md](../workflows/subagent-delegation.md).

### Machine-readable graph

A graph manifest owns execution structure.

It declares:

- stable task IDs;
- dependency edges;
- explicit parallel groups;
- resource scopes;
- retries and timeouts;
- result schemas;
- join behavior.

The graph binds every node to an exact source commit.

### Loom agent workflows

Loom currently runs deterministic leaf tools.

Expand Loom with an isolated `agentWorkflow` request family.

That family will own:

- graph validation;
- deterministic ready-wave scheduling;
- one disposable worker per reached task;
- typed result and artifact handoff;
- retry and cancellation state;
- resource-conflict serialization.

The scheduler and existing Loom tools share one typed YAML protocol.

Existing tools remain callable leaf nodes.

Policy and semantic worker contracts remain in Cortex.

The workflow engine does not invent product or architecture decisions.

Use the Codex SDK as an execution adapter for local worker threads.

Choose the Codex integration boundary with a focused spike.

The spike must prove:

- subscription reuse;
- cancellation;
- streamed lifecycle events;
- structured results;
- one worker per reached task;
- exact-source binding.

The official Codex SDK can start, continue, and resume local Codex threads.

The spike must still prove that the selected SDK path reuses the intended
ChatGPT subscription session in Nook's local environment.

Delete Lace after the Loom graph model is ready.

Do not retain its generated graph, recursive execution, default payloads, or
no-op agent facade as compatibility layers.

### Hive

Hive is the durable isolated execution platform.

Neo4j already owns task readiness, leases, attempts, results, and dependency
artifacts.

One Hive Pod runs one embedded Codex thread for one task.

Do not quietly enable nested subagents inside a Hive worker.

That would change its isolation, lease, artifact, and workspace model.

Future durable graphs should materialize child work as separate Hive tasks.

Each task should run in its own disposable Kata-backed Pod.

### Delivery owner

One delivery owner remains outside the worker fan-out.

That owner controls synthesis, shared mutations, PR state, validation, and
merge.

Workers return evidence or isolated patches.

They do not compete for delivery ownership.

## First workflow

The first graph is a read-only Cortex semantic audit.

It contains three inventory nodes:

1. workflows and references;
2. design docs, product specs, and dynamic skills;
3. code, Task, Loom, Minds, and CI evidence.

One synthesis node depends on all three inventories.

The synthesis node produces the proposed conflict resolutions.

The delivery owner authors the final documentation edit.

The pilot must measure:

- missed conflicts;
- duplicate findings;
- wall time;
- integration effort;
- result-schema failures.

The pilot has no code writes.

It has no GitHub or Workbench mutations.

## Adoption sequence

1. Add the typed `agentWorkflow` family to Loom.
2. Add manifest validation and dry-run planning.
3. Reject missing dependencies, cycles, unreachable joins, and resource
   conflicts.
4. Emit deterministic ready waves and skipped nodes.
5. Delete Lace and remove it from the Minds workspace.
6. Add the Codex SDK adapter after subscription and cancellation proof.
7. Execute the read-only Cortex graph with disposable workers.
8. Add exact-head CI diagnosis and review-verification graphs.
9. Prove isolated patch integration for one low-risk module workflow.
10. Materialize durable graph nodes as separate Hive tasks.

Write-capable parallel execution is not the starting point.

It begins only after baseline binding, resource scopes, result artifacts, and
parent integration have been proven with read-only work.

## Non-goals

This decision does not:

- make model output deterministic;
- replace Cortex prose with YAML;
- move semantic policy or product judgment into Loom;
- make Loom the durable task store or isolated worker platform;
- allow concurrent writers in one worktree;
- transfer Workbench or GitHub ownership to child workers;
- enable nested Hive workers.

## External evidence

- [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents.md)
  documents project-instruction-triggered delegation and recommends starting
  with read-heavy parallel work.
- [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk.md) documents
  programmatic local Codex threads for internal tools and workflows.
