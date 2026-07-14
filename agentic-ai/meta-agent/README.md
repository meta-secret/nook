# Nook meta-agent

`meta-agent` turns one developer feature prompt into a validated,
repository-grounded task DAG and can execute that DAG with embedded Codex
workers.

It remains a local host process and does not create GitHub issues, branches, or
commits.

## Embedded Codex runtime

The CLI embeds OpenAI's Codex Rust source from `main` through one direct dependency, aliased as `codex` in `Cargo.toml` from OpenAI's public `codex-core-api` facade. `ThreadManager` creates in-process `CodexThread` sessions, and `Op::UserInput` submits prompts with strict JSON schemas. Planning and execution therefore run in the meta-agent process with:

- an ephemeral, read-only planning session;
- one ephemeral workspace-write thread per runnable implementation task;
- the target repository as Codex's working directory;
- strict planner and task-completion output schemas; and
- the developer's existing `CODEX_HOME` authentication and configuration.

No Codex CLI parser, subprocess, CLI-over-JSONL wrapper, app-server transport,
HTTP server, repository mount, or Docker socket is involved. The adapter uses
the developer's `CODEX_HOME` authentication and constructs ephemeral core
configurations with read-only planning permissions or workspace-write execution
permissions. `Cargo.lock` records the exact `main` commit used by a build;
refreshing Codex is an explicit lockfile update because these source-crate APIs
are not a separately versioned stable SDK contract.

OpenAI `main` currently relies on patched WebSocket crates for proxy support. Cargo does not inherit a Git dependency's workspace-level `[patch]` entries, so this manifest mirrors those two upstream patch overrides. They are not additional direct Codex dependencies; `cargo tree --depth 1` exposes only the single aliased `codex` facade.

The `CodexRunner` and execution-agent traits contain that upstream coupling. The
adapter consumes core thread events directly for planning and implementation
turns.

## Usage

Install Rust 1.96 and ensure the host `CODEX_HOME` contains Codex authentication, then run:

```bash
task meta-agent:plan PROMPT='Add a repository-grounded feature planner'
```

Planning defaults to `gpt-5.6-luna` with `low` reasoning effort (the API name
for Luna's lighter reasoning setting).

The command presents a compact, colored progress view with named planning
phases, numbered repository-inspection steps, warnings, and a final execution
schedule. Shell commands stay hidden during normal operation and are shown only
when an inspection fails; incomplete structured JSON remains internal. Set
`NO_COLOR=1` to disable terminal colors.

Override the model or reasoning effort when needed:

```bash
task meta-agent:plan \
  PROMPT='Add resumable provider synchronization' \
  META_AGENT_MODEL=gpt-5.6-sol \
  META_AGENT_REASONING_EFFORT=medium
```

Validate an existing artifact and print conflict-safe execution batches:

```bash
task meta-agent:validate FEATURE=agentic-ai/meta-agent/target/features/resumable-sync
```

Execute every task in dependency order, with safe tasks in each wave running in
parallel:

```bash
task meta-agent:execute \
  FEATURE=agentic-ai/meta-agent/target/features/resumable-sync
```

Each worker must explicitly report `completed` or `blocked`. A blocked or failed
task stops the run before any descendant starts. Workers share the repository
working tree, may modify only their declared write scope, and are forbidden from
creating commits, branches, worktrees, or stashes.

Parallel workers share a compact, line-oriented terminal feed. Every event is
tagged with a stable colored task label. The default view shows bounded reasoning
excerpts, readable action names, edited paths, test duration/results, warnings,
and completion summaries. Full reasoning streams, ordinary command output, and
structured completion JSON remain hidden; failed commands reveal a concise
output excerpt and the command needed for debugging. For example:

```text
  ◆  Wave 1/5 · 2 agents
     ○  harden-core-onboarding-lifecycle
     ○  streamline-simple-onboarding-ui
    ●  harden-core-onboarding-lifec… start   · Agent started
    ●  streamline-simple-onboardin… start   · Agent started
    ◇  harden-core-onboarding-lifec… think   · Inspecting lifecycle invariants and existing Rust tests
    ↳  streamline-simple-onboardin… action  · 02 Reading implementation context · LoginGate.svelte
    ✎  harden-core-onboarding-lifec… edit    · Editing nook-app/nook-core/src/vault/vault_connect.rs
    ✓  harden-core-onboarding-lifec… result  · 8.4s · test result: ok. 12 passed; 0 failed
```

Run the host Rust format, Clippy, and test gate:

```bash
task meta-agent:check
```

## Artifact format

Each feature gets one directory:

```text
agentic-ai/meta-agent/target/features/resumable-sync/
├── feature.yaml
├── feature.md
├── design-protocol.md
├── implement-client.md
└── integration-tests.md
```

`feature.yaml` is the source of truth. Task IDs are mapping keys, YAML order has no meaning, and dependency direction is explicit:

```yaml
version: 1
feature:
  id: resumable-sync
  title: Resumable synchronization
  summary: Resume interrupted provider synchronization safely.
  issue: feature.md
  acceptance_criteria:
    - Interrupted synchronization resumes without data loss.
semantics:
  depends_on: Every referenced task must complete successfully before this task becomes runnable.
  resources: Tasks must not run concurrently when either task's write scope overlaps the other's read or write scope; resource conflicts do not imply a logical dependency.
defaults:
  priority: medium
tasks:
  design-protocol:
    title: Design the resume protocol
    description: Define checkpoints, retries, and compatibility behavior.
    priority: high
    depends_on: []
    resources:
      read:
        - .cortex/**
      write:
        - .cortex/design-docs/**
    acceptance_criteria:
      - Checkpoint and retry semantics are documented.
    issue: design-protocol.md
```

The Markdown files are issue-ready views. `feature.md` is the parent issue; every `<task-id>.md` is a focused child issue.

## Validation and scheduling

The Rust domain layer rejects:

- missing dependency targets;
- omitted `depends_on` fields, including for root tasks;
- self-dependencies;
- dependency cycles;
- unstable or duplicate task IDs;
- unsafe issue filenames; and
- missing Markdown issue files.

Logical dependencies and resource constraints stay separate. The scheduler
derives runnable tasks from mandatory `depends_on` fields, then splits a logical
wave into deterministic batches whenever one task's write scope overlaps
another task's read or write scope. The executor runs every task in a batch
concurrently, waits for explicit successful completion, and only then unlocks
the next batch.

Artifact publication is staged in a temporary sibling directory and renamed only after every file is rendered. Existing feature directories are never replaced implicitly.
