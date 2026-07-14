# Meta-agent feature DAG

Status: local planner and DAG executor implemented

## Purpose

Long feature milestones cannot be executed safely by assigning every child issue to an independent coding agent at once. Logical prerequisites are often implicit, and tasks that are logically independent may still contend for the same files. The meta-agent converts one developer prompt into a local, reviewable execution contract before GitHub issues or implementation agents are created.

## Integration decision

`agentic-ai/meta-agent` is a standalone host Rust CLI. Its Codex adapter tracks OpenAI's `main` branch through one direct dependency, aliased as `codex` from the public `codex-core-api` facade; `Cargo.lock` records the resolved commit. `ThreadManager` creates an in-process `CodexThread`; the planner submits `Op::UserInput` with its JSON schema and consumes core completion/error events. The ephemeral, read-only planning turn shares the meta-agent process, current worktree, linked Git metadata, `CODEX_HOME` authentication, and artifact filesystem without a CLI parser, Codex subprocess, app-server transport, HTTP server, repository mounts, credential mounts, or Docker socket access.

The adapter uses normal `CODEX_HOME` authentication and constructs core configurations with the repository working directory, `AskForApproval::Never`, ephemeral threads, and explicit workspace roots. Planning uses a read-only permission profile; task execution uses workspace-write. Git dependencies do not inherit their source workspace's `[patch]` sections, so the manifest mirrors OpenAI's two required WebSocket patch overrides; they are transitive source fixes, not extra direct Codex dependencies. The upstream source crates are not a separately versioned stable SDK contract, so Codex-specific types remain behind local runner traits.

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
- `resources.read` and `resources.write` contain anticipated repository-relative scopes. A write scope overlapping another task's read or write scope serializes otherwise-runnable tasks but does not create a fake dependency.
- Existing feature directories are never replaced implicitly.

The planner validates dependency references, self-dependencies, cycles, stable kebab-case IDs, issue filenames, and non-empty task values before atomically publishing the directory.

## Scheduling

The scheduler first derives runnable tasks from completed dependencies. It then builds a deterministic maximal safe batch greedily in task-ID order, excluding tasks whose writes may overlap a selected task's reads or writes. Completing a batch can unlock dependent work or allow another conflict-serialized task to run.

This creates two separate relationships:

1. dependency edges describe required implementation order;
2. read/write scopes describe concurrency safety.

The execution controller honors both without rewriting resource conflicts as dependencies. It starts one ephemeral embedded Codex thread for every task in a safe batch and polls them concurrently. Each worker receives the canonical task Markdown, feature acceptance criteria, completed dependency IDs, and strict instructions to stay inside its declared write scope and avoid Git mutations. Workers return structured `completed` or `blocked` results. The controller waits for the entire batch; any blocked turn, Codex error, or invalid completion JSON stops execution before descendants become runnable.

Concurrent thread events are rendered as a line-oriented multiplexed feed with
stable colored task labels. The default output exposes bounded reasoning
summaries, semantic command actions, edited paths, verification result excerpts,
warnings, and final task summaries. It suppresses raw reasoning streams, normal
command output, and completion JSON so parallel workers remain readable; failed
commands reveal a compact output tail and command for diagnosis.

## Execution boundary and follow-up

Execution intentionally uses one shared worktree because safe batches have non-conflicting declared resources. It does not create milestones/issues, branches, worktrees, commits, or stashes, and it does not persist resumable execution state yet. GitHub publication, per-agent worktree isolation, resume, and reconciliation remain separate future capabilities so the developer can review the generated local plan before granting execution.
