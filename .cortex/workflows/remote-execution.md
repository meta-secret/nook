# GitHub-Hosted Remote Execution

GitHub-hosted runners are the normal execution environment for agent builds,
tests, linting, coverage, and browser suites. Agent machines remain responsive
for editing, repository inspection, host-applied formatting, the UI demo
contract, and interactive development servers.

## Two remote surfaces

Nook intentionally separates iterative investigation from merge authorization:

1. **Focused remote tasks** run through the manually dispatched
   [`.github/workflows/remote.yml`](../../.github/workflows/remote.yml).
   They are repeatable debugging evidence and do not authorize merge.
2. **Complete PR validation** runs through
   [`.github/workflows/pr.yml`](../../.github/workflows/pr.yml) only after an
   agent explicitly applies a validation label. Its exact-head checks and
   deployment are required for readiness.

Ordinary PR pushes do not start complete validation. This lets an agent commit
and push several experimental iterations, use focused hosted tasks between
iterations, and spend the full parallel PR pipeline only when the head is
ready.

## Focused remote tasks

List the allowlisted catalog:

```bash
task remote:list
```

Dispatch one task:

```bash
task remote TASK_NAME=rust:test
```

The command accepts only catalog names. The workflow contains the corresponding
literal Taskfile command; user input is never evaluated as arbitrary shell.
Remote jobs receive read-only repository and Actions permissions, restore only
the trusted Main BuildKit lineage, and never write shared caches.

Every remote result is tied to source GitHub can reproduce. Before dispatch,
`task remote` requires:

- a non-`main` branch;
- a clean worktree;
- a branch present on `origin`; and
- the remote branch SHA to equal local `HEAD`.

The normal iteration is:

```bash
task format
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

Dispatch independent catalog tasks separately when they can run in parallel;
GitHub assigns each workflow to an available hosted worker:

```bash
task remote TASK_NAME=rust:test
task remote TASK_NAME=wasm:test
task remote TASK_NAME=web:test
```

The first version deliberately does not accept arbitrary environment variables,
commands, or secrets. Add a reviewed catalog entry when another stable remote
capability is needed.

## Explicit complete PR validation

When the current PR head is ready for merge validation, trigger its required
checks explicitly:

```bash
task pr:validate PR=<number>
```

For a PR repairing a failure observed on `main`, request the Main-equivalent
browser suites as part of the same validation:

```bash
task pr:validate PR=<number> FULL_E2E=1
```

The command verifies local `HEAD` equals the PR head, then removes and re-adds
the relevant label:

- `ci:validate` for normal validation;
- `ci:full-e2e` for Main-fix validation.

GitHub Actions does not support filtering `pull_request` triggers by label name
before creating the workflow run. `pr.yml` therefore listens for label events,
runs a small request guard that rejects every unsupported label, and allocates
product-validation workers only for these two labels. Agents must use the Task
command so an already-present label is toggled and produces a new event.

When `ci:full-e2e` remains on a Main-fix PR, every later validation request keeps
the browser and extension gates active. A normal `ci:validate` event cannot
downgrade a PR that is already marked for Main-equivalent coverage.

Remote browser jobs preserve Playwright `test-results`, including traces,
screenshots, videos, and attached `nook-app-logs.json`, as run artifacts even
when the selected task fails.

Any later push changes the PR head. Checks and deployment for the earlier SHA do
not authorize the new head, and `task pr:ready` must reject it until the agent
triggers validation again. Do not push while a complete validation is running;
if the tested commit is obsolete, cancel that run explicitly, push the complete
replacement, and trigger a fresh validation.

## Failure loop

Focused task failure:

```text
read failed run logs → fix → task format → commit → push
→ dispatch the useful focused task again
```

Complete PR validation failure:

```text
read failed PR logs and app artifacts → fix → task format → commit → push
→ optional focused remote tasks → task pr:validate → monitor exact-head checks
```

Never treat a focused remote task as a substitute for complete PR validation.
Never fall back to heavy local product gates merely because a hosted task
failed. Interactive local servers and browser inspection remain appropriate
when the debugging work intrinsically requires a persistent local session.

## Merge boundary

Before squash merge:

1. the latest pushed SHA has a successful explicitly triggered PR workflow;
2. the required `github-pages` deployment belongs to that exact SHA;
3. applicable Main-fix browser jobs are green;
4. all actionable feedback is resolved; and
5. `task pr:ready PR=<number>` succeeds.

The successful exact-head audit, not the continued presence of a label, is the
merge authorization boundary.
