---
name: coding-bro
description: >-
  Default agent workflow for every coding task in this repository: fetch repo,
  branch from origin/main, implement the request, run local checks and tests,
  push, open PR, monitor CI, fix until green, squash merge. Always follow this
  pipeline for implementation work unless the user explicitly asks for a
  read-only or question-only answer.
---

# Coding Bro

**Default workflow for all implementation tasks.** Every coding request follows this implement → verify → PR → monitor → merge pipeline unless the user only wants an answer or review with no code changes.

Read [`.cortex/AGENTS.md`](../../.cortex/AGENTS.md) and [`.cortex/workflows/pull-requests.md`](../../.cortex/workflows/pull-requests.md) before starting.

## How it works

0. **Prompt** — User gives a task description.
1. **Fetch repository** — Sync with remote before branching.
2. **Branch from `origin/main`** — Never commit on `main`. Create a feature branch for the work (PR comes after implementation).
3. **Implement** — Make the requested change. Follow repo conventions in `.cortex/`.
4. **Local checks** — Run code checks and unit tests before pushing. Run e2e locally when the change is complex (vault sync, login/unlock, multi-step web flows).
5. **Push** — Push the branch to origin.
6. **Open PR and monitor** — Create the PR, then watch CI until every required check finishes. When all checks pass, **squash merge** (`gh pr merge <n> --squash`).
7. **Fix on failure** — If CI fails, read logs, fix root cause, run e2e locally if needed, commit, push.
8. **Push fixes** — Push updated commits to the same PR branch.
9. **Repeat** — Return to step 6 until every check is green and the PR is squash-merged.

## Progress checklist

Copy and track:

```
Coding Bro Progress:
- [ ] 0. Prompt received
- [ ] 1. Fetched repository
- [ ] 2. Branch created from origin/main
- [ ] 3. Implementation complete
- [ ] 4. Local checks passed
- [ ] 5. Pushed to origin
- [ ] 6. PR opened; monitoring CI
- [ ] 7–9. Fix loop (if needed) until green
- [ ] Squash merged
- [ ] Duration report
```

## Commands (Nook)

### Step 1 — Fetch

```bash
git fetch origin main
```

### Step 2 — Branch

```bash
git checkout -b <branch-name> origin/main
```

Use a descriptive branch name (`feat/…`, `fix/…`, `chore/…`).

### Step 4 — Local checks

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

**E2e when the change is big or complex** (vault sync, join, login/unlock, Playwright helpers):

```bash
task web:test:e2e:pr
# or, after task check already built wasm + dist:
task web:test:e2e:pr:parallel
```

Skip e2e for isolated Rust-only or docs-only changes.

**After any remote CI failure** — run `task ci:pr` before pushing again (not just `task check`).

### Step 5–6 — Push and open PR

```bash
git push -u origin HEAD
gh pr create --title "…" --body "$(cat <<'EOF'
## Summary
…

## Test plan
- [ ] …
EOF
)"
gh pr checks <number> --watch
```

### Step 7 — Fix loop

```bash
gh run view <run-id> --log-failed
task ci:pr          # reproduce locally before next push
# fix, commit, push
gh pr checks <number> --watch
```

### Step 6 — Merge (only when all checks green)

```bash
gh pr merge <number> --squash
```

Squash merge only. Never `--merge` or `--rebase`.

## Rules

- **Never push directly to `main`.** Branch → PR → squash merge.
- **Never stop after push.** Monitor CI through merge or explicit handoff.
- **Never kill the Docker daemon** — only stop containers (`docker stop`). See `.cortex/rules.md` §5.
- **Do not merge** unless the user asked for merge-on-green or the task implies it.
- End with a **duration report** (wall-clock from first implementation step to final message). See `.cortex/workflows/pull-requests.md` §8.

## Related skills

- **babysit** — triage PR comments and keep an existing PR merge-ready.
- **gh-fix-ci** — debug failing GitHub Actions checks with explicit approval before fixes.
