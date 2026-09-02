# Workbench Issue Management

## Overview

Use this workflow whenever a task reveals missing functionality that is too
large, risky, blocked, or outside the current PR's safe scope. Agents must not
hide unfinished work in chat history or PR summaries.

Nook development issues live as versioned Markdown in
[`meta-secret/nook-workbench`](https://github.com/meta-secret/nook-workbench),
not in GitHub Issues. GitHub Issues are historical input only.

Every task-owning agent publishes two linked lifecycle records:

1. a structured task plan before implementation begins; and
2. a completion or blocked worklog when the task ends.

The task plan is an LLM-authored interpretation of the important request, not a
copy, transcript, or sentence-by-sentence paraphrase of the user's prompt.

## Repository boundary

The Nook product repository owns source code, architecture, tests, CI, and the
rules under `.cortex`. Nook Workbench owns:

```text
issues/<feature>/README.md
issues/<feature>/<focused-deliverable>.md
plans/<feature>/<timestamp>-<task>.md
worklogs/<feature>/<timestamp>-<issue-or-pr>.md
stats/ai-agent/<nook-pr>.yaml
stats/main-build/<run-id>-attempt-<attempt>.yaml
```

A feature directory replaces a GitHub milestone and aggregate issue. Its
`README.md` owns the overall goal, shared decisions, current status, and issue
index. Focused Markdown files replace sub-issues.

## Feature scope

Create one focused issue and one immutable feature-slice Gizmo Workbench record
for the PR. The record is not a running agent or controller. Team Agent count
never determines PR or Gizmo count.

The feature `README.md` must record:

- the complete user-visible or operational outcome;
- the focused issue index;
- dependencies between capabilities;
- stable public or cross-module interfaces;
- feature-level acceptance criteria;
- current completion status.

- The planned PR must stay at or below 2,000 authored additions.
- Deletions do not count and have no limit.
- Do not create a size-driven issue sequence, successor PR, or PR stack.
- If the planned work cannot fit, record the blocker instead of decomposing the
  delivery automatically.
- Review fixes use the same 2,000-authored-addition limit.

See
[pull-requests.md](pull-requests.md#pull-request-size-and-modularity) for the
size measure and architectural rules.

## Trigger

Before an agent says any of the following, it must apply this workflow:

- "too big for this PR"
- "too risky to implement now"
- "out of scope"
- "follow-up"
- "not implemented"
- "future work"
- "blocked by ..."

The workflow also applies when tests, review comments, or implementation work
discover missing functionality that the current PR will not finish.

## Search first

Clone or update the Workbench outside the Nook working tree, then search feature
summaries, issues, plans, and worklogs with both product language and code
terms:

```bash
workbench_dir="$(mktemp -d)"
gh repo clone meta-secret/nook-workbench "$workbench_dir"
rg -n -i "<user words>|<code terms>" \
  "$workbench_dir/issues" "$workbench_dir/plans" "$workbench_dir/worklogs"
```

Do not infer current state from a historical Nook GitHub issue alone. Imported
records link their original issue bodies and comments, but the Workbench file is
now the mutable execution record.

## Required issue shape

Every focused issue follows
`issues/_templates/issue.md` and includes:

- YAML frontmatter with title, lifecycle status, priority, automation mode,
  owner, timestamps, source issues, related PRs, and dependencies;
- a canonical lowercase-hyphenated `gizmo_id` in every focused issue
  assigned by the current one-PR plan;
- context and an observable outcome;
- explicit included and excluded scope;
- testable acceptance criteria and required coverage;
- append-only progress, findings, and durable decisions;
- links to relevant Nook code, PRs, and historical discussions.

Valid statuses are `proposed`, `ready`, `in_progress`, `blocked`, `done`, and
`cancelled`. `automation` is `manual`, `agent`, or `hive`. The `hive` mode is
reserved for trusted Main-failure incidents consumed by the isolated k0s Hive
dispatcher. The bounded implementation workflow must not claim those records.

This combination makes a record eligible for explicit dispatch to the bounded
Nook implementation worker:

```yaml
status: ready
automation: agent
owner: <nook-github-collaborator>
```

Dispatch treats `gizmo_id` as canonical trusted routing metadata. Its syntax
must be valid. It must never be changed to create a fresh identity. The
published per-issue plan must use it as `Current Gizmo ID` and its sole slice
Gizmo ID. That plan must declare one PR and use the same ID on every ownership
unit. A missing or invalid `gizmo_id` blocks dispatch before the issue is
claimed.

- The owner must be an assignable Nook GitHub collaborator with write access.
- The dispatch must provide exactly one of `issue_path` or `prompt`.
- An issue dispatch resolves only the exact requested path.
- A missing or unassigned owner fails without implementation.
- Each explicit dispatch creates its own workflow run.
- The Workbench blob SHA rejects concurrent claims of the same issue.
- An explicit rerun of a manual implementation may reactivate only the blocked
  issue generated by that same workflow run.
  - Verify the run marker, owner, title, automation mode, and canonical
    `gizmo_id` before mutation.
  - Use the current Workbench blob SHA to change `blocked` to `in_progress`.
  - Append a progress entry for the reactivation.
  - Preserve the issue path and canonical `gizmo_id`.
  - Any identity or blob mismatch blocks the rerun.
  - Do not create a replacement issue or task identity.
- Creating or editing any other record must not start implementation.
- The worker claims an eligible record by committing `status: in_progress`
  before it runs.
- Main-failure handoff records use `status: ready` with `automation: hive`.

A single token-free dispatcher reconciles those records into Neo4j by failed Main
SHA. The isolated task owns:

- diagnosis;
- exact-head PR checks;
- review resolution;
- squash merge; and
- verification of the resulting Main run.

## Choose update versus create

Update an existing file when it already owns the broad problem or focused
deliverable. Preserve prior progress, findings, decisions, links, and acceptance
criteria. Add a dated progress entry instead of erasing history.

Create a new feature directory only when no existing feature owns the work.
Create its `README.md` first, then add focused issue files and link them from the
feature index. Do not put unrelated work into a flat `backlog` directory merely
to avoid naming the feature; `backlog` is primarily the historical import area.

## Publishing changes

Workbench records are content, not Nook product changes. Publish a single
record directly with the checked-in helper. For an existing issue, first read
the file and retain the blob SHA that the local edit is based on, then pass that
exact SHA as `NOOK_WORKBENCH_EXPECTED_SHA`:

```bash
export NOOK_WORKBENCH_EXPECTED_SHA="$(
  gh api repos/meta-secret/nook-workbench/contents/issues/<feature>/<issue>.md \
    --jq .sha
)"
node .github/scripts/workbench-publish.cjs \
  /absolute/path/to/local-record.md \
  issues/<feature>/<issue>.md \
  "issues: update <feature>/<issue>"
```

The helper rejects an existing mutable record when the expected SHA is absent
or no longer current. Refetch and merge concurrent progress instead of
overwriting it. New plans, worklogs, and statistics use unique paths and do not
need an expected SHA; existing statistics are immutable and cannot be replaced.

For coordinated multi-file restructuring, use a focused Workbench branch and
PR. Never mix Workbench files into a Nook implementation PR.

## Team safety

Before editing a record, inspect its status, owner, updated timestamp,
dependencies, related PRs, and recent worklogs.

Agents must not:

- claim or reassign another active owner's `in_progress` work;
- mutate another active task's branch;
- mutate another active task's pull request;
- reply to or resolve another active task's reviews;
- trigger another active task's checks;
- change another active task's merge state;
- mark acceptance criteria done without validation evidence;
- delete prior findings, failed approaches, blockers, or decisions;
- switch `automation: agent` or `status: ready` merely to organize a draft;
- copy or lightly reformat prompts or chats into the Workbench;
- store credentials, secrets, vault data, private user information, environment
  values, or raw logs in any record.

When overlap involves another active owner, report the finding without changing
their record.

When no active owner exists, add the finding to the likely issue. Leave a new
record `proposed` rather than creating competing execution state.

Related scope does not transfer ownership. An explicit user, owner, or
orchestrator handoff is required before another agent may mutate the feature or
its focused issues. See
[agent-feature-ownership.md](../dynamic-skills/agent-feature-ownership.md).

## Task-start plan requirement

Before implementation edits, every task-owning agent must publish one plan from
`plans/_templates/plan.md`, including for a direct user request with no issue.
Use `plans/<feature>/<timestamp>-<task>.md`; use the closest feature or
`unplanned` when no feature record exists.

The task plan is an LLM-authored interpretation of the important request. It is
not a copy, transcript, or sentence-by-sentence paraphrase of the user's prompt.

The plan must contain:

- a `Mission controller` value fixed to `Gizmo Prime`;
- a `Current Gizmo ID` matching the current and first PR slice;
- for a focused issue, a `Current Gizmo ID` matching its canonical trusted
  `gizmo_id` exactly;
- the agent's own complete interpretation of the desired outcome;
- material functional, workflow, security, and delivery requirements;
- explicit constraints, assumptions, and exclusions;
- a small ordered execution plan;
- a `Change budget and PR sequence` section;
- an `Estimated authored changed lines` value;
- an `Owning modules, packages, or layers` value;
- consecutively numbered `Ownership units`, one per capability, each referencing
  the one declared `Gizmo ID`;
- a `Public or cross-module interfaces` value;
- a `Delivery shape` value fixed to `One PR`;
- a `PR sequence mode` value fixed to `One PR`;
- a `Current PR estimated authored changed lines` value;
- a `Current PR slice and acceptance evidence` value;
- a `PR slices, estimates, and acceptance evidence` value with exactly one row;
  - the row uses the current Gizmo ID;
  - its predecessor is `None`;
  - its non-negative estimate is at most 2,000; and
  - it states the PR acceptance evidence;
- expected completion evidence; and
- a safety review confirming that no raw prompt, transcript, secret, private
  data, raw log, local path, or unnecessary infrastructure detail is present.

Each ownership unit uses the exact field order from
`.github/prompts/agent-plan.md`. It names one functional owner and capability
acceptance contract. When an expertise provider will change files, it also
enumerates exact repository-relative code, test, and forbidden paths,
consumer interfaces, and provider-owned evidence. Otherwise every expertise
field is `None`.

### Publish the plan

Plans are immutable start snapshots.

Publish a superseding plan when the request, design, scope, or estimate changes
materially.

Do not rewrite the earlier plan.
Use the checked-in publisher for interactive work:

```bash
NOOK_WORKBENCH_SOURCE_TASK_FILE=/absolute/private/source-task.md \
NOOK_WORKBENCH_ASSIGNED_ISSUE_PATH=issues/<feature>/<issue>.md \
NOOK_WORKBENCH_ASSIGNED_GIZMO_ID=<focused-issue-gizmo-id> \
  node .github/scripts/workbench-publish.cjs \
  /absolute/path/to/local-plan.md \
  plans/<feature>/<timestamp>-<task>.md \
  "plan: start <task>"
```

- Keep the source-task file outside the checkout.
  - It lets the publisher reject copied prompt text.
  - Do not publish it.
- Set the assigned issue path and `NOOK_WORKBENCH_ASSIGNED_GIZMO_ID` from the
  trusted focused-issue dispatch when publishing its plan. Omit both fields
  only for a direct standalone plan that has not reached PR delivery.
- When that direct task reaches PR delivery:
  1. publish its immutable direct task-start plan;
  2. create the focused issue with the plan's canonical `gizmo_id`;
  3. publish a distinct superseding plan bound to that issue and `gizmo_id`;
  4. retain and link both immutable plan URLs.
- The bounded worker:
  1. uses a dedicated planning LLM turn;
  2. validates and publishes the plan; and
  3. begins implementation only after publication.
- A missing or rejected plan blocks implementation.
- A plan above the 2,000-authored-addition limit blocks implementation.

## Worklog requirement

Every task-owning agent must publish one worklog before reporting completion or
a blocker, even when the task began from a direct user prompt and had no issue.
Use `worklogs/_templates/worklog.md`, set its `plan` field to the corresponding
task plan, and include:

- outcome and material progress;
- implementation problems and root causes;
- durable decisions and tradeoffs;
- validation and linked Nook PR;
- remaining work or `None`.

Update the associated issue status and `related_prs` in the same completion
boundary. A merged Nook PR normally moves the issue to `done`; a concrete
external blocker moves it to `blocked`.

## Required handoff

The final response or PR comment must link:

- the Workbench feature and focused issue file;
- the task-start plan;
- the new worklog;
- the Nook implementation PR;
- what was completed versus what remains.

Re-open the published files before handoff and verify the links and state are
visible on Workbench `main`.
