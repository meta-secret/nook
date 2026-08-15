# Pull Request Workflow

Use this checklist for every change that lands on `main`. **AI agents must follow [coding-bro.md](coding-bro.md)** — the default implement-to-merge pipeline — and the detailed [agent pipeline](#agent-pipeline) below. Do not stop at push.

This workflow applies only to the current task's owned feature and focused
issues.

Another active task's branch and pull request are read-only.

Without an explicit handoff, do not:

- push to it;
- reply to its reviews;
- resolve its reviews;
- close or reopen it;
- change its labels;
- trigger its checks;
- merge it.

Full ownership policy:
[agent-feature-ownership.md](../dynamic-skills/agent-feature-ownership.md).

## PR-first agent contract

For implementation tasks, the agent's default job is not "make local edits".
It is "land a PR with Nook's applicable GitHub Actions PR test checks green."

Start by confirming feature ownership and establishing the PR path. Keep that
ownership until merge or a concrete blocked handoff:

1. **Prepare the PR path first:**
   - Fetch `origin/main`.
   - Estimate the authored changed lines.
   - Define the module boundary.
   - Split larger features into an ordered PR sequence.
   - Create the first feature branch.
   - Define the first PR's title, body, and scope.
2. **Implement functionality** — make the requested code/docs/tests changes on the feature branch. Focused build/test feedback runs on GitHub-hosted workers.
3. **Prepare a coherent commit:**
   - Run `task loom:pre-push`.
   - Commit the formatted change.
   - Run advisory local Codex review before the first owner-authored push.
   - For a harness-created PR, the continuing owner runs local review after
     handoff instead.
4. **Push and create or update the PR.**
5. **Request review and validate on GitHub Actions:**
   - Run focused `task remote TASK_NAME=<name>` jobs as useful.
   - Use focused hosted tasks while iterating.
   - When the coherent head is ready, run one complete-validation command:
     `task pr:validate PR=<number>` or
     `task loom:pr-land CONFIG=<pr-land-validate-request.yaml>`.
   - It dispatches checks and then requests exact-head Codex Cloud review.
   - Review-request failure does not block those checks.
   - Fix every actionable finding that arrives while checks run.
   - If no feedback exists when checks finish, continue without waiting.
   - Do not request or wait for other optional reviewers.
   - Inspect the path-applicable `PR / Verify and preview` and `Web research / Build and deploy research catalog` workflows.
   - Do **not** run a required local `task check` / `task ci:pr`.
6. **Fix Nook's failed PR workflow.** Inspect CI and app logs. Fix the
   failure, run pre-push hygiene, and push the complete fix. Request review and
   validate the replacement head together.
7. **Merge automatically when ready.** Require a current branch, green
   repository-owned checks, resolved actionable comments, and the exact-head
   readiness audit. Then squash-merge without separate permission.

## Pull request size and modularity

### Size boundary

An implementation pull request must target no more than **5,000 authored
changed lines**.

This is a planning ceiling.

It exists because review, validation, conflict resolution, and repair cost
rise sharply once a change becomes too large to reason about as one unit.

Estimate the size before implementation.

Re-estimate when the design changes or the diff grows unexpectedly.

Count additions and deletions against the intended base for:

- authored source;
- tests;
- documentation;
- configuration;
- scripts and workflow code.

During implementation, use `git diff --numstat <base>` for tracked working-tree
changes.

Count untracked authored files separately.

After every change is committed, use `git diff --numstat <base>...HEAD`.

Report these separately because they do not represent authored functionality:

- generated files;
- lockfiles;
- snapshots;
- vendored sources;
- binary artifacts;
- pure renames with no content change.

Do not exclude tests or delete-heavy refactors from the authored estimate.

Do not pad, compress, or mechanically reorganize code to fit the number.

Treat 4,000 authored changed lines as a planning warning.

At that point:

- stop adding unrelated responsibilities;
- re-estimate the remaining work;
- identify a stable interface between slices; and
- prepare an ordered Workbench sequence when the complete slice may cross the
  hard ceiling.

If the estimate approaches the ceiling, reduce scope before implementation.

If implementation crosses the ceiling, stop expanding that PR.

Do not delete, revert, or defer authored work merely to make the number pass.

Preserve the complete implementation before reducing the current PR:

1. Identify the last commit that contains the full work.
2. Publish a superseding Workbench plan.
3. Materialize the remaining slices as ordered focused issues.
4. Create a successor branch from that full-work commit.
5. Open a linked draft successor pull request.
6. Link both pull requests in their descriptions and Workbench records.
7. Inventory every file and behavior removed from the first pull request.
8. Verify that each item remains present in a linked successor pull request.
9. Only then reduce the first pull request to 5,000 lines or fewer.

The preservation inventory must use repository evidence.

Useful evidence includes:

- `git diff --numstat` for the removed range;
- `git diff --name-status` for deleted or restored files;
- `git range-diff` for rewritten commit sequences; and
- a Workbench checklist that maps each removed behavior to its successor PR.

Do not claim that code is preserved merely because an old commit remains
reachable in local Git history.

The successor branch and draft PR are the durable preservation boundary.

Preserve a coherent bounded portion.

Complete the first pull request before completing its successor.

After the first pull request merges:

1. Fetch current `origin/main`.
2. Rebase or merge the successor onto that exact base.
3. Change the successor base to `main` when it was temporarily stacked.
4. Re-measure its authored diff.
5. Continue the normal validation and merge loop.

If the successor is still too large, repeat the same preservation protocol
before removing any work from it.

A scope-reduction commit without a linked preservation PR is a P1 delivery
failure.

### Required plan

The Workbench task plan must state:

- the estimated authored changed lines;
- the files, packages, modules, or layers expected to change;
- the public or cross-module interfaces involved;
- whether one PR can deliver the complete feature;
- the current PR slice and its authored changed-line estimate;
- the ordered PR slices when more than one PR is needed;
- the acceptance evidence for each slice;
- a superseding immutable plan when scope or the estimate materially changes.

An estimate is a design tool.

It is not a promise of exact line count.

### Module-focused slices

Prefer one cohesive module, package, layer, or architectural responsibility per
pull request.

Apply SOLID principles as concrete review questions:

- Does the slice have one clear reason to change?
- Does new behavior extend a focused abstraction instead of adding conditionals
  across unrelated modules?
- Can a narrower interface replace a broad dependency?
- Do higher-level policies depend on stable abstractions?
- Are internal details hidden behind the owning module?

Public interfaces should change less often than internal implementations.

Design the narrow boundary before dependent slices begin.

Do not expose speculative APIs for work that has no planned consumer.

Each slice must be:

- coherent on its own;
- safe to merge;
- covered at the owning boundary;
- compatible with the previous merged slice;
- small enough for focused review and repair.

Each split must also preserve implementation continuity.

- The predecessor links every successor.
- Each successor links its predecessor.
- Workbench records the same order and dependencies.
- The feature stays `in_progress` until every required PR merges.
- Removed tests and documentation count as work that must be preserved.

A slice may prepare an interface or migrate one module before the complete user
flow is available.

Its acceptance criteria must still be independently observable.

### Multi-PR feature delivery

A feature may require many issues and pull requests.

Use one Workbench feature summary for the full outcome.

Create one focused issue for each independently mergeable slice.

Record dependencies and order in the feature index.

Then repeat this loop:

1. Implement the first ready issue.
2. Validate and squash-merge its pull request.
3. Update the feature and issue records.
4. Fetch current `origin/main`.
5. Start the next ready issue on a new branch.
6. Continue until the feature acceptance criteria are complete.

Remaining slices are required delivery work.

Do not label them optional follow-up work merely because the first pull request
merged.

Do not keep one long-lived branch for the full sequence.

A temporary preservation branch is allowed while the first PR is open.

It exists only to keep the remaining implementation reviewable and durable.

After the predecessor merges, update the successor from current `origin/main`.

See [issues.md](issues.md#multi-pr-feature-sequences) for Workbench ownership.

## ⛔ SQUASH MERGE ONLY

**Every PR merged into `main` MUST be squash-merged.**

| Allowed                         | Forbidden                                               |
| ------------------------------- | ------------------------------------------------------- |
| GitHub UI: **Squash and merge** | Create a merge commit                                   |
| CLI: `gh pr merge <n> --squash` | `gh pr merge --merge`                                   |
| One commit per PR on `main`     | `gh pr merge --rebase`                                  |
|                                 | Fast-forward that keeps branch commit history on `main` |

`main` must stay linear: **one squash commit per PR**. Feature branches can have many commits; that history is discarded at merge time.

If you merge a PR for the user, **confirm squash** before completing the merge. Merging any other way is a process violation.

## Agent pipeline

Named **coding bro** in [coding-bro.md](coding-bro.md). End-to-end flow for autonomous agents working on a task:

```mermaid
flowchart TD
  Z[0 Fetch origin/main] --> A[1 Branch + prepare PR]
  A --> I[2 Implement]
  I --> E[3 Format + push + open/update PR]
  E --> X[4 Focused task remote jobs as useful]
  X --> V[5 Explicit loom/pr validate]
  V --> F[6 Monitor applicable Nook PR checks on GHA]
  F --> G{Nook PR checks green?}
  G -->|no| H[7 Read app logs + fix + loom pre-push]
  H --> PUSH[8 Push completed fix]
  PUSH --> X
  G -->|yes| C[9 Address comments]
  C --> R[Run exact-head readiness audit]
  R -->|blocked| H
  R -->|ready| M[Squash merge PR]
  M --> S[Publish Workbench issue + worklog + stats]
  S --> J{Feature acceptance complete?}
  J -->|no, next issue ready| Z
  J -->|yes| K[Done]
```

### 0. Fetch and branch

Fetch before branching so the feature branch starts from current `origin/main`:

```bash
git fetch origin main
git checkout -b <branch-name> origin/main
```

Never commit directly on `main`.

### 1. Prepare the PR path

Before editing, complete the size and modularity plan above.

Decide the branch name and the first PR's scope, title, and body.

The PR may be opened after the first coherent commit.

The work must already be organized around getting that slice green and merged.

### 2. Implement

### 3. Push an exact remote-executable commit

When the branch has a coherent implementation, prepare the exact remote commit.
Run pre-push hygiene, commit, and run advisory local review. Then push and open
or update the PR. This makes the source available to focused hosted tasks. It
does not start complete validation.

Never run `task check`, a full test suite, build, e2e, or post-fix product validation as a required local gate before or after the push. This is not a license to push half-finished or unformatted work: always run `task loom:pre-push` before the push, and push once the branch is coherent enough to validate.

```bash
task loom:pre-push
git commit
task pr:review-local
git push -u origin HEAD
gh pr create --title "…" --body "…"
```

See [pre-push-hygiene.md](../dynamic-skills/pre-push-hygiene.md).

Before the first owner-authored push, run `task pr:review-local` on the coherent
branch head. For a harness-created PR, run it immediately after handoff.

After each coherent push, inspect feedback already present.

Use focused remote tasks when they shorten diagnosis.

Trigger complete validation only when the head is ready for the final gate. It
dispatches checks immediately, then requests exact-head Codex review.

After a complete-gate failure, validate the completed replacement head again.

Do not wait for Codex review. Do not request or wait for other external
reviewers. See
[code-review.md](code-review.md).

The feedback inspection and readiness audit replace any blind review-batching grace period.

### 5. Hosted iteration and explicit validation

**GitHub-hosted execution is the normal build/test path.** `remote.yml` runs allowlisted focused tasks repeatedly against an exact pushed branch head. `pr.yml` is the sole merge-validation pipeline and runs only when an agent explicitly applies a validation label through `task pr:validate`.

```text
implement/fix → task loom:pre-push → commit → local review → push/update PR
→ complete exact-head PR workflow and Cloud review request
```

**Required local action** (before every push):

```bash
task loom:pre-push
```

Always run `task loom:pre-push` again before every fix re-push.

Focused hosted commands (never merge gates):

```bash
task remote TASK_NAMES=web:check,web:test
task remote TASK_NAMES=rust:test,rust:coverage
```

Complete validation:

```bash
task pr:validate PR=<number>
# Main-fix PR:
task pr:validate PR=<number> FULL_E2E=1
```

| When                       | Command                                          | Why                                             |
| -------------------------- | ------------------------------------------------ | ----------------------------------------------- |
| Before every push          | `task loom:pre-push`                             | Only required local product action              |
| UI-facing path changes     | included in Loom pre-push                        | Cheap hygiene before hosted execution           |
| Focused build/test feedback| `task remote TASK_NAMES=<a>,<b>`                | Reuse one hosted worker for selected tasks      |
| Final validation boundary  | `task loom:pr-land CONFIG=<pr-land-validate-request.yaml>`     | Start the complete exact-head PR gate           |
| After complete CI failure  | fix → Loom pre-push → commit → push → validate again | A push does not refresh `pr.yml`              |

See [ci-pipeline.md § Local vs remote CI](ci-pipeline.md#local-vs-remote-ci) and [github-actions-only-validation.md](../dynamic-skills/github-actions-only-validation.md).

Workflow cancellation must follow the scopes in [ci-pipeline.md § Workflow concurrency policy](ci-pipeline.md#workflow-concurrency-policy).

Explicit validation cancels only an older labeled run for the same PR. Unrelated PRs keep independent required checks.

Any cancellable live-provider job must also keep its external-resource cleanup in a separate `if: always()` step. An interrupted test process must not leak provider state.

### 5.1. Main-fix browser validation

Normal PR CI omits browser e2e. A PR fixing a failure observed on `main` must trigger the `ci:full-e2e` validation path, which runs the Main-equivalent local-provider and extension browser suites before merge:

```bash
task pr:validate PR=<number> FULL_E2E=1
```

Agents do not run full e2e locally. Use the remote catalog for focused browser feedback and the explicit Main-fix gate for merge validation.

### 6. Monitor only Nook's applicable PR test checks until green

`pr.yml` runs native Rust and WASM on independent hosted runners.

**Producer and consumer split:**

- After clippy/build, the WASM producer uploads only the small generated package.
- Parallel browser-free preview validation can begin while required Node tests continue.
- Preview deployment remains blocked until the producer succeeds.
- Optional browser-e2e consumers wait for that fully verified producer.
- No consumer recompiles Rust.

**Preview and coverage:**

- Preview deploys the internal harness plus isolated native Pages aliases for site, Simple, and Sentinel without waiting for native coverage.
- A separate native-dependent coverage job downloads the current run's Rust artifact directly.
- When a base comparison is required, it resolves an exact-commit trusted Main artifact.
- It never cold-builds the base revision.
- The isolated site alias is recorded as the successful `github-pages` deployment for ruleset enforcement.

**Main-fix browser jobs:**

- PRs labeled `ci:full-e2e` additionally run independent web and extension jobs on separate hosted runners.
- Each builds the Chromium image from verified WASM.
- The overall `PR` workflow cannot succeed until both jobs succeed.

**Do not stop after opening the PR.** Wait only for applicable repository-owned workflows:

- `PR`
- `Web research` when `.github/workflows/web-research.yml` or `nook-app/nook-web/nook-web-research/**` changes

Never use an all-check watcher that can remain blocked on external services. If neither repository workflow applies to the changed paths, there is no remote check to wait for.

```bash
task pr:preflight PR=<number>
```

Use `task loom:pr-land CONFIG=<pr-land-ready-request.yaml>` (or `task pr:ready`) for a read-only exact-head readiness assertion. The command never merges by itself. Its success is the final signal for the task-owning agent to squash-merge immediately.

Codex review is not a readiness requirement. Do not wait for it after
repository-owned checks finish. Do not request or wait for Claude, Cursor,
CodeRabbit, or other optional external reviews/checks. Repository-owned checks and exact-head
deployment remain required.

Before treating a PR as mergeable, **always verify the branch against the latest `origin/main`**.

Do this every time, even when all visible checks are green.

If a green PR cannot merge, assume the first and most likely blocker is that `main` advanced and the PR branch is stale.

GitHub may surface that stale-branch state as:

- an "Update branch" requirement
- `mergeStateStatus: BLOCKED`
- a missing active check because the green run belongs to an older base

Fetch `main`, compare divergence, and update the PR branch before chasing other branch-policy explanations:

```bash
git fetch origin main
git rev-list --left-right --count HEAD...origin/main
gh pr view <number> --json mergeStateStatus,baseRefOid,headRefOid,statusCheckRollup
```

If the branch is behind `origin/main`, merge the base branch into the PR branch, push, then explicitly validate Nook's workflows on the new head SHA. Do not merge until this freshness check passes:

```bash
git merge origin/main --no-edit
git push origin HEAD
task pr:validate PR=<number>
task pr:ready PR=<number>
```

### 6.1. Address review comments

Actionable PR feedback that already exists must be handled, whether it comes from a human reviewer, Codex, or another automated reviewer. Follow [code-review-comments.md](../dynamic-skills/code-review-comments.md) for the full checklist.

Agents must leave their own GitHub reply explaining the fix, validation, or no-change rationale before resolving any PR comment or review conversation. Do not resolve comments silently. Inspect submitted review bodies as well as inline review threads and PR comments:

```bash
gh pr view <pr-number> --comments
head_sha="$(gh pr view <pr-number> --json headRefOid --jq .headRefOid)"
gh api repos/meta-secret/nook/pulls/<pr-number>/reviews \
  --jq ".[] | {user: .user.login, state, body, html_url, commit_id, current_head: (.commit_id == \"$head_sha\")}"
```

Treat actionable submitted-review bodies as current only when `current_head` is `true`.

Keep older review bodies as audit context. Use thread `isOutdated` state plus the current code when deciding whether an older inline finding still needs a reply.

Use the GitHub review-thread GraphQL query from the [code-review-comments skill](../dynamic-skills/code-review-comments.md) to inspect unresolved inline conversations.

Reply only on actual review threads/comments that support targeted replies.

Track actionable submitted review-body items without a threaded reply target in the checklist/final handoff rather than creating comment spam.

Resolve all actionable threads and re-query immediately before merge.

Do not wait for Codex after repository-owned checks finish. Do not request
other optional external reviews or status changes. See
[code-review.md](code-review.md).

### 7. Fix loop on failure

Investigation order: **test output** → **static analysis** → **app logs** (most important after the first two). See [logging.md § Debugging…](../references/logging.md#debugging-troubleshooting-and-ci-verification).

Static analysis includes Knip unused findings and jscpd clone/duplicate findings. Fix those problems in code; do not silence the gate. See [quality.md § Fix check findings](../workflows/quality.md#fix-check-findings--not-silence-them).

1. Read the failed job log: `gh run view <run-id> --log-failed`
2. For **e2e / web failures**, read persisted app logs before changing code: Playwright attachment `nook-app-logs.json`, local `fetchAppLogs(page)` / `/app-logs`, or `dumpNookLogs(page)`.
3. Fix the root cause.
4. Run `task loom:pre-push`, commit, and push the completed fix.
5. Run Loom/Task validate and return to monitoring Nook's complete exact-head PR checks. Use a focused `task remote` job only when it shortens diagnosis.
6. Complete validation requests Codex review for the replacement head. Never
   wait for its result after checks finish or request other review services.

If the failure was obviously fmt-only, `task loom:pre-push` before re-push is enough. Broader failures are proven by the refreshed remote `pr.yml` run on the latest head.

### 8. Merge and finish

When **Nook's applicable repository-owned PR test checks pass**, the branch is current with `origin/main`, all actionable comments are resolved, and `task loom:pr-land CONFIG=<pr-land-ready-request.yaml>` / `task pr:ready` succeeds:

```bash
gh pr merge <number> --squash
```

The successful squash merge completes implementation delivery. Do not wait for, monitor, or live-verify the resulting Main run unless the user explicitly requested deployment/live verification or assigned a Main failure.

After merge, `main.yml` independently runs full local-provider and extension **e2e**.

**Main failure incidents (Hive):**

- Every actionable unsuccessful Main run creates one `automation: hive` Workbench incident keyed by failed SHA.
- This includes `Web e2e`, `UI demos`, and `Extension e2e`.
- Each run attempt creates a run-and-attempt-keyed delivery generation whose plan/worklog are generation-specific.
- A later failed rerun supersedes and cancels an active delivery before the new generation is enqueued.
- The dispatcher retries only after a poll interval longer than the worker heartbeat.
- The durable barrier is the worker's Neo4j acknowledgement that the stale Codex execution stopped.
- The old generation remains `CANCELLING` until worker acknowledgement or confirmed deletion of its recorded Kubernetes Pod, including cancelling exclusive blockers.
- Reconciliation of the current generation is idempotent.
- Successful reruns retire existing incidents and stop active delivery.
- The isolated Hive dispatcher enqueues actionable incidents once.
- One logical task owns diagnosis, a normal exact-head PR, actionable review resolution, squash merge, and verification of the resulting Main run.
- The scheduled `agent-implement.yml` worker does not claim Hive incidents.
- Credentialed sync-live checks are available only through explicit manual validation.

### 9. Post-merge Workbench context and statistics

Every normal AI-agent-owned PR continues through a Workbench publication after merge. Follow [issues.md](issues.md) and [agent-statistics.md](agent-statistics.md):

- Update the associated issue.
- Add the agent worklog.
- Create `stats/ai-agent/<source-pr-number>.yaml`.
- Include all local validation and repository workflow executions/retriggers plus merge attempts and elapsed time.
- Record the repository test inventory on the merged head.
- Compare with recent comparable records and assess waste.

Publish these records directly to `meta-secret/nook-workbench` `main`.

Do not:

- create a bookkeeping Nook branch or PR
- wait for post-merge Main
- include a Main run merely because the implementation PR triggered one

If the comparison identifies actionable performance regression or workflow waste, create a separate normal Nook build-performance PR and take it through the full pipeline.

Completed Main attempts independently commit one automated `stats/main-build/<run-id>-attempt-<attempt>.yaml` record to Workbench after the workflow finishes. Because no Nook ref changes, publication cannot recurse. See [main-build-statistics.md](main-build-statistics.md).

### 10. Task completion report

Every agent turn that **finishes a user-assigned task** must end with a short **completion report** that includes **how long the work took**.

**When to report:** After the task is done — merged implementation PR, delivered answer, or explicit handoff. Do not wait for a post-merge Main run unless deployment/live verification was explicitly requested. Do not omit this on multi-step work that spans monitor/fix/merge cycles; report once at the very end.

**What to measure:** Wall-clock time from when you **started working on the user's request** (first implementation step or investigation for that assignment) until you send the final message. Include CI wait time if you monitored checks as part of the task.

**Format** — add a `## Duration` line (or equivalent) in the final reply:

```markdown
## Duration

12m 34s (started 2026-06-28T20:15:00Z, finished 2026-06-28T20:27:34Z)
```

Rules:

- Use a human-readable duration (`Xm Ys`, or `Xh Ym` when over an hour).
- Include UTC ISO timestamps for start and finish when you can infer them; otherwise duration alone is acceptable.
- If the task was blocked waiting on the user, exclude idle wait time and note `active time: …` vs `elapsed: …`.
- For question-only turns with no implementation, a duration line is optional.

**Docker:** Never kill the Docker daemon — only stop containers (`docker stop`). See [rules.md §5](../rules.md#docker-daemon--never-kill-it).

## Standard flow (summary)

See [coding-bro.md](coding-bro.md) for the numbered 0–12 checklist.

1. Fetch `origin/main` and branch from it.
2. Implement the focused change.
3. Run `task loom:pre-push`.
4. Commit the formatted change.
5. Run `task pr:review-local` before the first owner-authored push.
6. For a harness-created PR, run local review after handoff instead.
7. Push and open or update the PR.
8. Use focused `task remote` jobs only for faster isolated diagnosis.
9. Run Loom or Task validation on the ready head.
10. It dispatches checks and then requests exact-head Codex review.
11. Do not wait for review after checks finish or request optional reviews.
12. Address and resolve actionable comments.
13. On failure, fix the issue and repeat pre-push hygiene.
14. Push the fix and explicitly validate the replacement head.
15. Squash-merge after the exact-head readiness audit succeeds.
16. Publish the Workbench completion records.
17. Report task duration.

## CLI reference

```bash
# Open PR
gh pr create --title "…" --body "…"

# Merge (ONLY this form)
gh pr merge <number> --squash
```

See also [rules.md §6](../rules.md#6-git--pull-request-workflow).
