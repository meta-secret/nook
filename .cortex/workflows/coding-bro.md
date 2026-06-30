# Coding Bro — Default Agent Workflow

**System of record** for how every AI agent handles implementation tasks in this repository. The Cursor skill at [`.cursor/skills/coding-bro/SKILL.md`](../../.cursor/skills/coding-bro/SKILL.md) mirrors this doc for auto-invocation.

Use this pipeline for **every coding request** unless the user explicitly wants a read-only answer, review-only feedback, or a question with no code changes.

## How it works

0. **Prompt** — User gives a task description.
1. **Fetch repository** — Sync with remote before branching.
2. **Branch from `origin/main`** — Never commit on `main`. Create a feature branch for the work.
3. **Implement** — Make the requested change. Follow [rules.md](../rules.md) and package boundaries in [ARCHITECTURE.md](../ARCHITECTURE.md).
4. **Local checks** — Run code checks and unit tests before pushing. Run e2e locally when the change is complex (vault sync, login/unlock, multi-step web flows).
5. **Push** — Push the branch to origin.
6. **Open PR and monitor** — Create the PR, then watch CI until every required check finishes. When all checks pass and merge is requested, **squash merge** (`gh pr merge <n> --squash`).
7. **Fix on failure** — If CI fails, read logs, fix root cause, run e2e locally if needed, commit, push.
8. **Push fixes** — Push updated commits to the same PR branch.
9. **Repeat** — Return to step 6 until every check is green and the PR is squash-merged.

```mermaid
flowchart TD
  P[0 Prompt] --> F[1 Fetch origin/main]
  F --> B[2 Branch from origin/main]
  B --> I[3 Implement]
  I --> L[4 Local checks + e2e if complex]
  L --> PU[5 Push]
  PU --> PR[6 Open PR + monitor CI]
  PR --> G{All checks green?}
  G -->|no| FIX[7–8 Fix + push]
  FIX --> PR
  G -->|yes| M[Squash merge]
  M --> D[Duration report]
```

## Commands

### 1 — Fetch

```bash
git fetch origin main
```

### 2 — Branch

```bash
git checkout -b <branch-name> origin/main
```

Use a descriptive branch name (`feat/…`, `fix/…`, `chore/…`).

### 4 — Local checks

**Minimum before every push:**

```bash
task format:check    # or task format after edits
task check           # fmt, lint, unit tests, web build
```

Scoped subsets when the touch surface is narrow:

```bash
task web:check && task web:test    # web-only
task rust:test                     # nook-core only
```

**Before opening the PR** (mirrors PR CI):

```bash
task ci:pr
```

**E2e when the change is big or complex:**

```bash
task web:test:e2e:pr
# or, after task check already built wasm + dist:
task web:test:e2e:pr:parallel
```

Skip e2e for isolated Rust-only or docs-only changes.

**After any remote CI failure** — run `task ci:pr` before pushing again.

See [pull-requests.md § Local checks](pull-requests.md#2-local-checks-before-every-push) and [ci-pipeline.md § Local vs remote CI](ci-pipeline.md#local-vs-remote-ci).

### 5–6 — Push, open PR, monitor

```bash
git push -u origin HEAD
gh pr create --title "…" --body "…"
gh pr checks <number> --watch
```

### 7–8 — Fix loop

```bash
gh run view <run-id> --log-failed
task ci:pr
# fix, commit, push
gh pr checks <number> --watch
```

### 6 — Merge

When all checks pass and the user asked to merge (or the task implies merge-on-green):

```bash
gh pr merge <number> --squash
```

Squash merge only. See [rules.md §6](../rules.md#6-git--pull-request-workflow).

## Non-negotiables

- **Never push directly to `main`.** Branch → PR → squash merge.
- **Never stop after push.** Monitor CI through merge or explicit handoff.
- **Never kill the Docker daemon** — only stop containers. See [rules.md §5](../rules.md#docker-daemon--never-kill-it).
- **Duration report** on every completed implementation task. See [pull-requests.md §8](pull-requests.md#8-task-completion-report).

## Related docs

- [pull-requests.md](pull-requests.md) — squash merge policy, detailed agent pipeline, CLI reference
- [ci-pipeline.md](ci-pipeline.md) — GitHub Actions workflow map
- [monorepo.md](monorepo.md) — cross-package change checklist (runs inside step 3)
