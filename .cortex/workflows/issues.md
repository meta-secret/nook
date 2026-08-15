# Workbench Issue Management

## Relationships

- [Agent Feature Ownership](../dynamic-skills/agent-feature-ownership.md)
  - Defines the Agent Feature Ownership context used by this document.
  - Apply when implementation or delivery reaches this workflow boundary.
- [Pull Request Workflow](pull-requests.md)
  - Defines pull-request size, validation, readiness, review, and merge requirements.
  - Apply when implementation or delivery reaches this workflow boundary.

## Document map

- [Overview](#overview)
  - Preserves oversized, risky, blocked, or deferred work in Nook Workbench.
  - Read when required work cannot safely remain in the current pull request.
- [Repository boundary](#repository-boundary)
  - Separates product artifacts from Workbench planning and delivery records.
  - Read before deciding where new context belongs.
- [Multi-PR feature sequences](#multi-pr-feature-sequences)
  - Defines ordered feature, issue, plan, worklog, and PR relationships.
  - Read when work must be split across multiple pull requests.
- [Trigger](#trigger)
  - Lists the statements and conditions that activate this workflow.
  - Read before deferring, blocking, or excluding required work.
- [Search first](#search-first)
  - Requires searching existing Workbench context with product and code vocabulary.
  - Read before creating a feature or focused issue.
- [Required issue shape](#required-issue-shape)
  - Defines required issue metadata, acceptance criteria, dependencies, and evidence.
  - Read when creating or auditing a focused issue record.
- [Choose update versus create](#choose-update-versus-create)
  - Distinguishes extending the owning record from creating a new deliverable.
  - Read after search results identify related Workbench context.
- [Publishing changes](#publishing-changes)
  - Defines the direct-to-main publication path for Workbench records.
  - Read before committing and pushing planning context.
- [Team safety](#team-safety)
  - Prevents agents from claiming or overwriting another owner's active record.
  - Read before updating shared Workbench state.
- [Task-start plan requirement](#task-start-plan-requirement)
  - Requires a validated Workbench plan before implementation edits.
  - Read at the start of every task-owning implementation.
- [Worklog requirement](#worklog-requirement)
  - Requires one outcome-focused worklog before completion or blocker handoff.
  - Read when recording final evidence and remaining work.
- [Required handoff](#required-handoff)
  - Defines the plan, issue, worklog, and PR links required in a handoff.
  - Read before reporting completion or a blocker.

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

## Multi-PR feature sequences

One feature may require many focused issues and pull requests.

Create a sequence when the complete feature is expected to exceed 5,000
authored changed lines.

Also create a sequence when separate module ownership makes independent slices
safer, even below that size.

The feature `README.md` must record:

- the complete user-visible or operational outcome;
- the ordered issue index;
- dependencies between slices;
- stable public or cross-module interfaces;
- feature-level acceptance criteria;
- current completion status.

Each focused issue must own one cohesive module, package, layer, or
architectural responsibility.

Each issue should normally map to one pull request.

Every issue must be independently testable and mergeable.

Later issues must consume stable interfaces from earlier slices instead of
repeatedly rewriting them.

After a slice merges:

1. Update its issue and the feature index.
2. Publish the required worklog and statistics.
3. Choose one owner for the next dependency-free issue.
4. If the current agent continues, claim the issue as `in_progress` before
   starting its branch from current Nook `origin/main`.
5. If scheduled automation will continue, set `status: ready` and
   `automation: agent`.
6. In that case, the current agent must not also start the issue.

The feature remains incomplete while any required issue remains incomplete.

Do not convert remaining requested functionality into an optional follow-up.

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
- context and an observable outcome;
- explicit included and excluded scope;
- testable acceptance criteria and required coverage;
- append-only progress, findings, and durable decisions;
- links to relevant Nook code, PRs, and historical discussions.

Valid statuses are `proposed`, `ready`, `in_progress`, `blocked`, `done`, and
`cancelled`. `automation` is `manual`, `agent`, or `hive`. The `hive` mode is
reserved for trusted Main-failure incidents consumed by the isolated k0s Hive
dispatcher; the scheduled implementation workflow must not claim those records.

This combination makes a record a candidate for the scheduled Nook
implementation worker:

```yaml
status: ready
automation: agent
owner: <nook-github-collaborator>
```

The owner must be an assignable Nook GitHub collaborator with write access.

The scheduled scan skips candidate records with a missing or unassigned owner.
An explicitly requested ownerless record fails without implementation.

Creating or editing any other record must not start implementation.

The worker claims an eligible record by committing `status: in_progress`
before it runs.

Main-failure handoff records instead use `status: ready` with `automation:
hive`.

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

- the agent's own complete interpretation of the desired outcome;
- material functional, workflow, security, and delivery requirements;
- explicit constraints, assumptions, and exclusions;
- a small ordered execution plan;
- a `Change budget and PR sequence` section;
- an `Estimated authored changed lines` value;
- an `Owning modules, packages, or layers` value;
- a `Public or cross-module interfaces` value;
- a `Delivery shape` value;
- a `Current PR estimated authored changed lines` value;
- a `Current PR slice and acceptance evidence` value;
- a `PR slices and acceptance evidence` value;
- expected completion evidence; and
- a safety review confirming that no raw prompt, transcript, secret, private
  data, raw log, local path, or unnecessary infrastructure detail is present.

Plans are immutable start snapshots.

Publish a superseding plan when the request, design, scope, PR sequence, or
estimate changes materially.

Do not rewrite the earlier plan.
Use the checked-in publisher for interactive work:

```bash
NOOK_WORKBENCH_SOURCE_TASK_FILE=/absolute/private/source-task.md \
  node .github/scripts/workbench-publish.cjs \
  /absolute/path/to/local-plan.md \
  plans/<feature>/<timestamp>-<task>.md \
  "plan: start <task>"
```

The source-task file stays outside the checkout.

It lets the publisher reject copied prompt text.

Do not publish that file.

The scheduled implementation worker uses a dedicated planning LLM turn,
validates and publishes the plan, and only then begins its implementation turn.
A missing or rejected plan blocks implementation.

A valid multi-PR plan also blocks scheduled implementation.

Materialize its Workbench feature summary and focused issues first.

Then dispatch the first focused issue with a bounded one-PR plan.

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
