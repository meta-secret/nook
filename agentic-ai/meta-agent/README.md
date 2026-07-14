# Nook meta-agent

`meta-agent` turns one developer feature prompt into a validated, repository-grounded task DAG that can later drive multiple Codex workers safely.

The first release is a planner, validator, and artifact generator. It does not create GitHub issues or execute the generated tasks yet.

## Why `codex exec`

The CLI invokes the installed Codex CLI as a subprocess with:

- an ephemeral, read-only planning session;
- the target repository as Codex's working directory;
- a strict JSON output schema; and
- the developer's existing host Codex authentication and configuration.

This is the smallest documented automation boundary for one-shot jobs. The Codex app-server is a better future adapter when the meta-agent needs long-lived threads, steering, approvals, and streamed event handling. OpenAI currently documents TypeScript and Python SDKs, but no public Rust SDK, so depending on internal Codex Rust crates would couple this project to unstable implementation details.

The `CodexRunner` Rust trait isolates that choice. A future app-server adapter can replace the subprocess without changing DAG validation, scheduling, or artifacts.

## Usage

Install Rust 1.96 and authenticate the Codex CLI once on the host, then run:

```bash
task meta-agent:plan PROMPT='Add a repository-grounded feature planner'
```

Override the output root or model when needed:

```bash
task meta-agent:plan \
  PROMPT='Add resumable provider synchronization' \
  FEATURE_OUTPUT_ROOT=agentic-ai/features \
  META_AGENT_MODEL=gpt-5.4
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
