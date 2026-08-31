# Nook Agent Routing Contract

This file is the repository entry point. It selects one owning context and
states only boundaries that apply everywhere. Detailed delivery and delegation
rules belong to Gizmo's linked authorities.

## Mandatory context selection

1. Read the [root context router](knowledge-graph.md).
2. Classify the work as Gizmo delivery control, AI, development core, security,
   SRE, web development, or shared integration.
3. Load exactly one owning `AGENTS.md` and knowledge graph.
4. Open only the documents and headings needed for the assigned work.
5. Stop loading Cortex when the task can be executed safely.

Do not preload all graphs, a whole team corpus, or foreign-team material for
background context. A selected team authority may link a task-relevant
foreign-team skill as read-only engineering policy. A foreign-team writer
requires an explicit expertise task from Gizmo Prime.

## Context routes

- [Gizmo Prime](gizmo/AGENTS.md) owns mission planning, delegation,
  integration, review coordination, GitHub and Workbench state, readiness, and
  merge.
- [AI contract](teams/ai/AGENTS.md) and
  [graph](teams/ai/knowledge-graph.md): Cortex, Loom, agent skills, routing, and
  agent automation.
- [Development core contract](teams/dev-core/AGENTS.md) and
  [graph](teams/dev-core/knowledge-graph.md): portable Rust behavior,
  cryptography, authorization, storage, and typed WASM contracts.
- [Security contract](teams/security/AGENTS.md) and
  [graph](teams/security/knowledge-graph.md): security architecture, trust
  boundaries, security policy, and security review.
- [SRE contract](teams/sre/AGENTS.md) and
  [graph](teams/sre/knowledge-graph.md): CI/CD, clusters, deployments, runners,
  containers, and operations.
- [Web development contract](teams/web-dev/AGENTS.md) and
  [graph](teams/web-dev/knowledge-graph.md): TypeScript, Svelte, browser
  behavior, and extension interaction.

Gizmo Prime is the existing root delivery owner. A feature-slice Gizmo is an
immutable typed Workbench slice record, not a process, agent, worker attempt,
or second coordinator. See the [Gizmo contract](gizmo/AGENTS.md).

## Team worker contract

- Each worker task has exactly one team identity, a bounded file scope, and
  named acceptance evidence. Workers write only inside that scope.
- Team workers implement and test their assigned changes. Gizmo Prime controls
  shared integration and external delivery state and does not implement team
  work on their behalf.
- Security review does not transfer implementation ownership. Portable
  security behavior stays in Rust/WASM; web code receives public typed
  projections.
- Agents mutate only their owned feature. Another active agent's work is
  read-only until ownership is explicitly transferred. See
  [agent feature ownership](gizmo/dynamic-skills/agent-feature-ownership.md).
- Exactly two trusted GitHub Actions publishers are narrow exceptions to the
  committed worker-handoff path:
  - `agent-implement.yml` gives its bounded editor no Git or external delivery
    authority. Trusted host tooling formats, validates change budget and PR
    identity, publishes, and returns the exact head.
  - `rust-dependency-updates.yml` may publish only through `task ci-agent:fix`
    with `CI_AGENT_FIX_PROFILE=rust-dependency-update`. Its bounded editor has
    no Git or external delivery authority; the job rejects persisted checkout
    credentials, freezes HEAD and index, accepts only declared Rust dependency
    files, and verifies PR number, base, head ref, and remote SHA before
    publication.
  - Neither exception grants publication authority to an ordinary worker.
    Gizmo owns review, validation, readiness, and merge for the returned head.
- The source-size limit is a non-bypassable hard rule: every authored source
  file stays at or below the **1,000-line delivery limit**. A violation blocks
  delivery and requires a
  cohesive domain or architectural decomposition; moving unit tests or making
  arbitrary fragments is not compliance. Rust unit tests remain inline with
  their focused implementation, while crate-level integration tests remain
  separate. See [source file size](shared/dynamic-skills/source-file-size.md).
- Repository-authored automation uses TypeScript/Bun, Rust, and Taskfiles. It
  does not use Python.
- Keep `.cortex/.session/` temporary and physically clean before readiness.

## Cortex authoring

A task whose write claims overlap `.cortex/**` requires the canonical typed
Cortex authoring composition:

- `teams/ai/dynamic-skills/cortex-writer.md`;
- `teams/ai/dynamic-skills/cortex-article-structure/SKILL.md`; and
- `teams/ai/dynamic-skills/cortex-consistency.md`.

Before dispatch, Gizmo includes the typed `cortexAuthoring` grant in the
immutable Loom generation. Admission validates the candidate batch, lease,
exact frontier, team-owned writes, and any serialized shared-file grants before
the harness receives context paths. Team-specific authoring skills may add
domain policy but must not copy or rename the canonical skills.

Promote durable lessons only when evidence justifies them. The
[self-improvement skill](teams/ai/dynamic-skills/self-improvement.md) keeps
temporary notes optional and requires cleanup before readiness.

## Delivery and validation

An implementation request continues through the user-selected terminal state.
Unless the user selects an intermediate handoff, Gizmo owns pull-request
creation, exact-head evidence, readiness, merge, remote verification, and
Workbench completion. A worker commit is task completion, not mission
completion.

### Scheduled-task and PR scope

- Codex scheduled tasks are prohibited. Do not create, suggest, or update a
  Codex automation, heartbeat, reminder, recurring follow-up, or deferred task
  for repository work.
- An agent may plan its own sequencing, polling cadence, and bounded waits
  inside the active task. That plan is ephemeral execution behavior. It must
  not be materialized as a Codex scheduled task.
- Repository-owned GitHub Actions, Workbench automation fields, and Hive
  reconciliation are separate systems governed by their existing authorities.
- A request to test, monitor, and merge a PR when ready remains one active
  delivery task. Use bounded direct waits against that PR and merge it in the
  same task when readiness is satisfied.
- The target PR is the delivery scope. Consult `origin/main` only when the PR
  workflow requires base freshness. Do not monitor, diagnose, or repair the
  Main workflow or unrelated default-branch health unless the user explicitly
  assigns that separate work.

Use the detailed authority only when its stage is reached:

- [Canonical delegation](gizmo/workflows/subagent-delegation.md) owns task,
  attempt, admission, lease, evidence, retry, and join semantics.
- [Mission delivery](gizmo/workflows/mission-delivery.md) owns the end-to-end
  delivery sequence.
- [Pull requests](gizmo/workflows/pull-requests.md) owns exact-head review,
  validation, readiness, and merge.

Run `task loom:cortex-audit` after Cortex changes. Knowledge graphs index
documents, not their headings; update a graph only when document ownership,
path, or discoverability changes.
