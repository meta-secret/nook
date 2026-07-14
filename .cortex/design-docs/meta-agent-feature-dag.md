# Meta-agent feature DAG

Status: initial planner implemented

## Purpose

Long feature milestones cannot be executed safely by assigning every child issue to an independent coding agent at once. Logical prerequisites are often implicit, and tasks that are logically independent may still contend for the same files. The meta-agent converts one developer prompt into a local, reviewable execution contract before GitHub issues or implementation agents are created.

## Integration decision

`agentic-ai/meta-agent` is a standalone host Rust CLI. Its Codex adapter tracks OpenAI's `main` branch through one direct dependency, aliased as `codex` from the public `codex-core-api` facade; `Cargo.lock` records the resolved commit. `ThreadManager` creates an in-process `CodexThread`; the planner submits `Op::UserInput` with its JSON schema and consumes core completion/error events. The ephemeral, read-only planning turn shares the meta-agent process, current worktree, linked Git metadata, `CODEX_HOME` authentication, and artifact filesystem without a CLI parser, Codex subprocess, app-server transport, HTTP server, repository mounts, credential mounts, or Docker socket access.

The adapter follows OpenAI's `thread-manager-sample`, uses normal `CODEX_HOME` authentication, and constructs a core configuration with the repository working directory, `AskForApproval::Never`, a read-only permission profile, an ephemeral thread, and explicit workspace roots. Git dependencies do not inherit their source workspace's `[patch]` sections, so the manifest mirrors OpenAI's two required WebSocket patch overrides; they are transitive source fixes, not extra direct Codex dependencies. The upstream source crates are not a separately versioned stable SDK contract, so all Codex-specific types remain behind the local `CodexRunner` trait. A later execution controller can retain core threads for persistent execution, turn steering, approval handling, and streamed events without changing planner domain logic.

## Artifact contract

One feature owns one directory:

```text
<output-root>/<feature-id>/
├── feature.yaml
├── feature.md
└── <task-id>.md
```

- `feature.yaml` is the canonical machine-readable plan.
- `feature.md` is the GitHub-ready parent issue.
- `<task-id>.md` is the GitHub-ready focused child issue.
- Task IDs are unique mapping keys. YAML order has no semantic meaning.
- `depends_on` contains logical prerequisites only. If task A depends on task B, B must complete successfully before A becomes runnable.
- `resources.write` contains anticipated repository-relative write scopes. Overlapping scopes serialize otherwise-runnable tasks but do not create a fake dependency.
- Existing feature directories are never replaced implicitly.

The planner validates dependency references, self-dependencies, cycles, stable kebab-case IDs, issue filenames, and non-empty task values before atomically publishing the directory.

## Scheduling

The scheduler first derives runnable tasks from completed dependencies. It then builds a deterministic maximal safe batch greedily in task-ID order, excluding tasks whose write scopes may overlap a task already selected for that batch. Completing a batch can unlock dependent work or allow another conflict-serialized task to run.

This creates two separate relationships:

1. dependency edges describe required implementation order;
2. write scopes describe concurrency safety.

An execution controller must honor both. It must not rewrite a resource conflict as a dependency because that would misrepresent the feature's domain structure and reduce future scheduling flexibility.

## Current boundary and follow-up

The initial release plans, validates, renders, and prints safe batches. It intentionally does not create milestones/issues, spawn task agents, manage branches/worktrees, or reconcile completed work. Those behaviors require a separate execution-state model and an explicit GitHub publication step so a developer can review the generated local plan first.
