# GitHub-Hosted Remote Execution

## Relationships

- [Quality and Release](quality.md)
  - Defines which focused and complete validation gates apply.
  - Read before selecting hosted checks for a change.
- [Pull Request Workflow](pull-requests.md)
  - Owns exact-head validation, readiness, and merge authorization.
  - Read before advancing from remote checks to merge.

## Document map

- [Overview](#overview)
  - Introduces the document context and its operating assumptions.
  - Read first before using the detailed guidance.
- [Two remote surfaces](#two-remote-surfaces)
  - Distinguishes focused hosted tasks from complete PR validation.
  - Read before selecting a remote execution surface.
- [Focused remote tasks](#focused-remote-tasks)
  - Defines the allowlisted path for narrow hosted checks.
  - Use when a bounded task needs targeted validation.
- [Explicit complete PR validation](#explicit-complete-pr-validation)
  - Defines the evidence and checks required for completion.
  - Use before declaring the work complete.
- [Failure loop](#failure-loop)
  - Explains failure modes and the supported recovery path.
  - Read when the normal path fails.
- [Merge boundary](#merge-boundary)
  - Defines what the guidance covers and where its ownership ends.
  - Read before expanding or assigning the work.

## Overview

GitHub-hosted runners are the normal execution environment for agent builds, tests, linting, coverage, and browser suites. Agent machines remain responsive for editing, repository inspection, host-applied formatting, the UI demo contract, and interactive development servers.

## Two remote surfaces

Nook intentionally separates iterative investigation from merge authorization:

1. **Focused remote tasks** run through the manually dispatched [`.github/workflows/remote.yml`](../../.github/workflows/remote.yml). They are repeatable debugging evidence and do not authorize merge.
2. **Complete PR validation** runs through [`.github/workflows/pr.yml`](../../.github/workflows/pr.yml) only after an agent explicitly applies a validation label. Its exact-head checks and deployment are required for readiness.

Ordinary PR pushes do not start complete validation. This lets an agent commit and push several experimental iterations, use focused hosted tasks between iterations, and spend the full parallel PR pipeline only when the head is ready.

## Focused remote tasks

List the allowlisted catalog:

```bash
task remote:list
```

Dispatch one task:

```bash
task remote TASK_NAME=rust:test
```

Dispatch several tasks in one hosted job:

```bash
task remote TASK_NAMES=rust:test,web:check,web:test
```

Batch behavior:

- Provision one runner and perform Docker setup once.
- Run tasks sequentially in the requested order.
- Accept at most eight tasks.
- Continue after a task fails and fail the final job when any selection failed.
- Keep each task's 15-to-45-minute timeout.
- On timeout:
  1. send `TERM` to the task and its process group;
  2. force termination after a one-minute grace period;
  3. remove Docker containers created by the task;
  4. restart the job-scoped BuildKit container;
  5. restore tracked source and remove non-ignored untracked files; and
  6. continue to later selections after marking the timed-out task failed.
- After every task, reselect the job-scoped hosted Buildx builder.
  - This prevents temporary builders from affecting later selections.
- Report every task result in the GitHub job summary.

Security and cache rules:

- Accept only catalog names.
  - Each name maps to a literal Taskfile command in
    `.github/scripts/remote-task-batch.sh`.
  - Never evaluate user input as shell.
- Grant remote jobs read-only repository and Actions permissions.
- Import an exact BuildKit lineage alone when it exists.
- When the exact scope is absent, seed it from source-free dependency scopes
  and trusted Main.
- Write git-commit Zot refs under `nook/remote-buildcache/**`.
- Give the Remote identity read-only access to `nook/buildcache/**`.
  - Tag selection alone is not the Main security boundary.

**SeaweedFS identity:**

- Rust compiler vertices use a separate SeaweedFS identity.
- It can read/list `nook-sccache` but cannot write compiler objects.
- Remote jobs cannot replace Main Zot refs or SeaweedFS compiler objects.
- Remote jobs cannot administer SeaweedFS identities and buckets.

The two cache layers solve different cold-start costs:

- **Zot** stores BuildKit layers, Cargo downloads, and completed dependency
  stages.
  - A Remote branch imports its own ref alone when present.
  - Otherwise it seeds from source-free dependencies and Main.
  - It exports only its own ref.
  - Both repositories use Zot's content-addressed blob deduplication.
- **SeaweedFS** stores compiler objects published by trusted Main/local/Hive writers. Remote reads those objects; genuinely new branch results persist in its Zot OCI layers until trusted Main publishes the corresponding compiler objects.

Credentials enter compiler vertices only through fixed optional BuildKit secret IDs and target paths.

- Secret contents are never build arguments or image state.
- They do not participate in the layer cache checksum.
- Local and credentialed hosted builds fail closed when SeaweedFS credentials or reachability are wrong.
- Only an explicit `SCCACHE_OPTIONAL=1` path (fork/release/secret-free hosted jobs) falls back to direct compilation.

The most frequently used checks have remote-only narrow orchestration:

- `rust:test` loads a source-sealed native dependency image.
- `web:check`, `web:test`, and `extension:check` load a source-sealed web dependency + generated WASM image.

This avoids building full coverage, WASM test, browser, verification, and production-dist branches before a focused command. It does not change the local task semantics or move branch execution onto persistent infrastructure.

Every remote result is tied to source GitHub can reproduce. Before dispatch, `task remote` requires:

- a non-`main` branch;
- a clean worktree;
- a branch present on `origin`; and
- the remote branch SHA to equal local `HEAD`.

The normal iteration is:

```bash
task loom:pre-push
git add -u
git commit -m "Describe the coherent experiment"
git push -u origin HEAD
task remote TASK_NAME=rust:test
```

Inspect and watch the run printed by the dispatcher:

```bash
gh run list \
  --workflow=remote.yml \
  --branch="$(git branch --show-current)" \
  --commit="$(git rev-parse HEAD)" \
  --event=workflow_dispatch
gh run watch <run-id> --compact --exit-status
```

Prefer one batch when several tasks need the same pushed head:

```bash
task remote TASK_NAMES=rust:test,wasm:test,web:test
```

- A batch avoids repeated checkout, Docker setup, and cache connection work.
- Use separate dispatches when parallel compute is more valuable than runner
  startup cost.
- The workflow accepts neither arbitrary environment variables nor commands.
- Its only credentials are the reviewed Zot login and scoped SeaweedFS build
  identity.
- Add a reviewed catalog entry for any new stable remote capability.

## Explicit complete PR validation

When the current PR head is ready for merge validation, trigger its required checks explicitly:

```bash
task pr:validate PR=<number>
```

For a PR repairing a failure observed on `main`, request the Main-equivalent browser suites as part of the same validation:

```bash
task pr:validate PR=<number> FULL_E2E=1
```

The command verifies local `HEAD` equals the PR head, then removes and re-adds the relevant label:

- `ci:validate` for normal validation;
- `ci:full-e2e` for Main-fix validation.

GitHub Actions cannot filter `pull_request` triggers by label name before
creating a workflow run. Therefore `pr.yml`:

- listens for label events
- runs a small request guard that rejects every unsupported label
- allocates product-validation workers only for these two labels

- Agents must use the Task command so an existing label is toggled and produces
  a new event.
- When `ci:full-e2e` remains on a Main-fix PR:
  - every later validation keeps browser and extension gates active; and
  - `ci:validate` cannot downgrade Main-equivalent coverage.

- Remote browser tasks preserve Playwright `test-results` as run artifacts.
  - Artifacts include traces, screenshots, videos, and attached
    `nook-app-logs.json`.
  - They remain available when a selected task fails.

- Before dispatching `web:e2e`, `extension:e2e`, `check`, `ci:pr`, or
  `ci:pr:e2e`, the Task command:
  - refreshes `origin/main`; and
  - fails closed unless the local exact head contains it.
- `task pr:validate` applies the same guard to the PR's declared base branch
  before toggling a validation label.
- Update, format, and push a stale branch before spending an expensive hosted
  cycle.

- Cheap focused tasks remain available for isolated diagnosis.
  - They are not a prerequisite for complete PR validation.
- Prefer complete validation when parallel PR jobs have a shorter critical path
  than a sequential focused batch.

- The final readiness audit detects when the base advances after a run starts.
- Any later push changes the PR head.
  - Checks and deployment for the earlier SHA do not authorize the new head.
  - `task pr:ready` must reject it until validation runs again.
- Do not push while complete validation is running.
- When the tested commit is obsolete:
  1. cancel that run explicitly;
  2. push the complete replacement; and
  3. trigger fresh validation.

## Failure loop

Focused task failure:

```text
read failed run logs → fix → task loom:pre-push → commit → push
→ dispatch the useful focused task again
```

Complete PR validation failure:

```text
read failed PR logs and app artifacts → fix → task loom:pre-push → commit → push
→ optional focused remote tasks → task pr:validate → monitor exact-head checks
```

Never treat a focused remote task as a substitute for complete PR validation. Never fall back to heavy local product gates merely because a hosted task failed. Interactive local servers and browser inspection remain appropriate when the debugging work intrinsically requires a persistent local session.

## Merge boundary

Before squash merge:

1. the latest pushed SHA has a successful explicitly triggered PR workflow;
2. the required `github-pages` deployment belongs to that exact SHA;
3. applicable Main-fix browser jobs are green;
4. all actionable feedback is resolved; and
5. `task pr:ready PR=<number>` succeeds.

The successful exact-head audit, not the continued presence of a label, is the merge authorization boundary.
