# Agent Workflow Orchestration

## Overview

Status: Architecture decision with staged implementation.

Nook separates repository policy from native harness coordination.

- **Cortex** documents what a workflow means.
- **Codex, Cursor, or another capable harness** creates and operates only
  Gizmo-authorized native worker attempts.
- **Loom** may execute the legacy standalone reviewed static read-only workflow
  graph described below. That path is outside Gizmo multi-team admission.
- **Nook tools** validate task contracts, isolated workspace handoffs, and
  deterministic integration evidence.

This design governs local software development only.
Hive is a separate product and infrastructure feature.
It does not represent, schedule, or persist local module-development work.

## Static graph decision

This decision applies only to workflows compiled into Loom.
Native harness delegation does not require a Loom graph.

Each compiled Loom workflow has a fixed, reviewed graph.

The existing `loom:agent-workflow:cortex-audit` command is a legacy standalone
read-only workflow. Its static scheduler selects its own eligible tasks and its
Codex SDK adapter directly creates their attempts. It predates and sits outside
the ordinary Gizmo multi-team admission contract. It must not be used to claim,
authorize, or execute that contract. Adding another standalone exception or
using this path for implementation work requires a separately reviewed
architecture decision.

### Reviewed graph contract

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

Native task lineage follows the root
[team worker contract](../../../AGENTS.md#team-worker-contract) and
[subagent delegation](../../../gizmo/workflows/subagent-delegation.md).

A compiled Loom graph still declares its own fixed hierarchy.
That hierarchy is an optional separate workflow.
It does not constrain capable native harness delegation beyond the repository's
task contract and ownership rules.

For native delegation, parent lineage and authority bounds are frozen task
metadata for validation and aggregation. They do not authorize an active
leased worker attempt to create another worker attempt. A missing dependency
returns to Gizmo for a replacement immutable generation, Loom/Nook candidate
computation, Gizmo admission authorization and frontier freezing, and harness
attempt creation after old-generation disposition.

### Local feature-development boundary

Feature planning uses the
[module-oriented development workflow](../../../gizmo/workflows/module-oriented-development.md).

- The feature dependency DAG controls readiness.
- Frozen task lineage records semantic parentage and authority bounds.
- Dependency chains do not increase hierarchy depth.
- Named semantic roles come from the
  [module expert registry](../architecture/module-experts.md).
- Every task carries a mandatory team identity separate from its expert.
- Team identity selects context only; explicit functional-owner metadata
  controls semantic acceptance, including acceptance of expertise results.
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

For that legacy standalone compiled workflow, the module owns its narrower
internal control path:

- the compiled workflow catalog;
- graph validation;
- deterministic eligibility and scheduling for its fixed read-only graph;
- typed result and artifact handoff;
- resource-conflict checks;
- append-only workflow events;
- terminal projections;
- declared timeout, retry, and cancellation policy executed by its standalone
  scheduler and SDK runtime.

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
- This command proves only its reviewed standalone read-only workflow contract.
  It does not perform Gizmo admission and cannot validate or authorize ordinary
  multi-team delegation.

### Codex worker adapter

The active Codex, Cursor, or other capable harness is the primary worker
adapter.

Its universal responsibilities are defined by the root worker contract and
subagent delegation workflow. It only creates, starts, runs, retries, cancels,
and communicates with attempts for Gizmo-authorized records. It does not
compute candidates, select or admit records, or snapshot or change frontiers.
Each authorized `(task ID, attempt ID)` maps to exactly one harness-visible
worker attempt. Logical tasks may retry sequentially with distinct attempt IDs,
but never have more than one concurrently active attempt.
Nook does not start another Codex or Cursor process to coordinate native
subagents.

The existing Loom Codex SDK adapter remains available only inside the legacy
standalone reviewed read-only workflow. Its static scheduler selects tasks and
directly invokes the adapter; those attempts are not Gizmo-admitted records.
This narrow historical path is not the native harness boundary and must not be
used for module experts, module-DAG implementation, or any ordinary multi-team
delegation claim.

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
- worker creation;
- synthesis;
- completion.

For ordinary multi-team delegation, Loom/Nook remains deterministic candidate
and frontier-data authority, Gizmo remains selection, admission-authorization,
frontier-freezing, and integrated-delivery authority, and the active harness
remains only worker-attempt lifecycle authority. The legacy standalone audit is
the explicit read-only exception above and cannot establish those properties.
Gizmo validates accepted commits and evidence against current repository state
before integration.

Future ordinary accepted-evidence synthesis follows that same authority split.
Its immutable generation freezes provider edges, expected producer identities,
typed input schema, and acceptance criteria, not artifacts that do not exist
yet. After every required provider succeeds and its evidence is accepted,
Gizmo binds the authorized synthesis attempt to the exact accepted artifacts,
digests, and inherited provenance matching those frozen terms. This is
admission data, not a plan mutation. Ordinary execution remains fail-closed
until the installed validator enforces the full contract.

### Delivery owner

Exactly one delivery owner remains outside the worker fan-out.

That owner controls:

- architectural synthesis;
- shared-file edits;
- Workbench state;
- branch and pull-request state;
- review coordination and verdict;
- review replies and thread state;
- validation requests;
- readiness and merge.

Implementation corrections and review or validation fixes remain responsible-
team worker tasks.

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
  - The legacy all-terminal join waits for every declared terminal observation,
    including failed lanes.
  - Every lane exposes a verified terminal-observation Markdown view to the
    diagnostic aggregator.
  - The diagnostic aggregation task deduplicates findings and authors the root
    aggregate view.
  - A failed observation is never accepted provider evidence. Neither it nor
    the aggregate output can satisfy an ordinary provider edge or claim the
    future accepted-evidence synthesis contract.
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

Native Coding Bro delivery and module-DAG implementation retain the same split:
Loom/Nook computes deterministic candidate data, Gizmo owns authorization and
frontiers, and the harness owns only attempt lifecycle. They do not require a
compiled Loom workflow.

The optional Loom catalog keeps these boundaries:

- Do not add a generic workflow builder.
- Do not add prompt-defined task cardinality.
- Do not create a general graph language outside TypeScript.

## Adoption sequence

The static Loom workflow foundation is complete and remains available for
bounded read-only audits.

Native module delivery proceeds separately:

1. Verify that the installed typed validator and focused tests enforce the full
   canonical admission contract. The current installed runtime does not, so
   ordinary multi-team delivery fails closed before dispatch.
2. Validate a frozen module DAG and task contracts only after that gate passes.
3. Let Loom/Nook compute candidates, conflicts, capacity, leases, and frontier
   data.
4. Let Gizmo validate the batch, select task records, admission-authorize one
   exact attempt ID per selection, freeze frontiers, and prepare isolated
   workspaces for authorized writers.
5. Let the active harness create and operate only those authorized attempts.
6. Verify each returned commit against its baseline and write scope.
7. Integrate accepted commits in deterministic dependency order.
8. Bind consumers to the exact integrated provider commit.
9. Give normal retries fresh isolated state under the exact frozen task
   contract and acceptance evidence. Any contract or acceptance change starts
   a new immutable generation with fresh attempts for every authorized record;
   surviving logical tasks are retries and new providers receive first
   attempts.
10. Prove the full provider-to-consumer path with focused tests.

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
- let an active leased worker attempt create another worker attempt;
- treat frozen lineage metadata as self-dispatch authority;
- let the active harness select or admit task records or snapshot or change
  frontiers;
- require Loom to coordinate native harness subagents;
- require JSONL or Markdown artifacts for workflow progress.

## External evidence

- [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents.md)
  documents project-instruction-triggered delegation.
- [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk.md) documents
  programmatic local Codex threads for internal workflows.
