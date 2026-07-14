# Nook meta-agent

`meta-agent` turns one developer feature prompt into a validated, repository-grounded task DAG that can later drive multiple Codex workers safely.

The first release is a planner, validator, and artifact generator. It does not create GitHub issues or execute the generated tasks yet.

## Embedded Codex runtime

The CLI embeds OpenAI's Codex Rust source from `main` through one direct dependency, aliased as `codex` in `Cargo.toml` from OpenAI's public `codex-core-api` facade. `ThreadManager` creates an in-process `CodexThread`, and `Op::UserInput` submits the developer prompt together with the planner's JSON schema. A planning turn therefore runs in the meta-agent process with:

- an ephemeral, read-only planning session;
- the target repository as Codex's working directory;
- a strict JSON output schema; and
- the developer's existing `CODEX_HOME` authentication and configuration.

No Codex CLI parser, subprocess, CLI-over-JSONL wrapper, app-server transport, HTTP server, repository mount, or Docker socket is involved. The adapter follows OpenAI's `thread-manager-sample`, uses the developer's `CODEX_HOME` authentication, and constructs an ephemeral read-only core configuration for the target repository. `Cargo.lock` records the exact `main` commit used by a build; refreshing Codex is an explicit lockfile update because these source-crate APIs are not a separately versioned stable SDK contract.

OpenAI `main` currently relies on patched WebSocket crates for proxy support. Cargo does not inherit a Git dependency's workspace-level `[patch]` entries, so this manifest mirrors those two upstream patch overrides. They are not additional direct Codex dependencies; `cargo tree --depth 1` exposes only the single aliased `codex` facade.

The `CodexRunner` Rust trait contains that upstream coupling. The current adapter already consumes core thread events directly; a future execution controller can retain threads for steering, approvals, and multiple turns without changing DAG validation, scheduling, or artifacts.

## Usage

Install Rust 1.96 and ensure the host `CODEX_HOME` contains Codex authentication, then run:

```bash
task meta-agent:plan PROMPT='Add a repository-grounded feature planner'
```

Planning defaults to `gpt-5.6-luna` with `low` reasoning effort (the API name
for Luna's lighter reasoning setting).

The command streams Codex reasoning summaries, repository inspection commands,
warnings, and plan-assembly status to the terminal while keeping the incomplete
structured JSON internal. The final line reports the generated feature
directory.

Override the output root or model when needed:

```bash
task meta-agent:plan \
  PROMPT='Add resumable provider synchronization' \
  FEATURE_OUTPUT_ROOT=agentic-ai/features \
  META_AGENT_MODEL=gpt-5.6-sol \
  META_AGENT_REASONING_EFFORT=medium
```

Validate an existing artifact and print conflict-safe execution batches:

```bash
task meta-agent:validate FEATURE=agentic-ai/features/resumable-sync
```

Run the host Rust format, Clippy, and test gate:

```bash
task meta-agent:check
```

## Artifact format

Each feature gets one directory:

```text
agentic-ai/features/resumable-sync/
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
  resources: Tasks with overlapping write scopes must not run concurrently; resource conflicts do not imply a logical dependency.
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
- self-dependencies;
- dependency cycles;
- unstable or duplicate task IDs;
- unsafe issue filenames; and
- missing Markdown issue files.

Logical dependencies and merge-conflict constraints stay separate. The scheduler derives runnable tasks from `depends_on`, then splits a logical wave into deterministic batches when repository-relative `resources.write` scopes may overlap. This prevents fake dependencies while keeping concurrent workers away from the same files.

Artifact publication is staged in a temporary sibling directory and renamed only after every file is rendered. Existing feature directories are never replaced implicitly.
