# Workbench Issue Management

Use this workflow whenever a task reveals missing functionality that is too
large, risky, blocked, or outside the current PR's safe scope. Agents must not
hide unfinished work in chat history or PR summaries.

Nook development issues live as versioned Markdown in
[`meta-secret/nook-workbench`](https://github.com/meta-secret/nook-workbench),
not in GitHub Issues. GitHub Issues are historical input only.

## Repository boundary

The Nook product repository owns source code, architecture, tests, CI, and the
rules under `.cortex`. Nook Workbench owns:

```text
issues/<feature>/README.md
issues/<feature>/<focused-deliverable>.md
worklogs/<feature>/<timestamp>-<issue-or-pr>.md
stats/ai-agent/<nook-pr>.yaml
stats/main-build/<run-id>-attempt-<attempt>.yaml
```

A feature directory replaces a GitHub milestone and aggregate issue. Its
`README.md` owns the overall goal, shared decisions, current status, and issue
index. Focused Markdown files replace sub-issues.

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
summaries, issues, and worklogs with both product language and code terms:

```bash
workbench_dir="$(mktemp -d)"
gh repo clone meta-secret/nook-workbench "$workbench_dir"
rg -n -i "<user words>|<code terms>" \
  "$workbench_dir/issues" "$workbench_dir/worklogs"
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
`cancelled`. `automation` is `manual` or `agent`.

Only this exact combination authorizes the scheduled Nook implementation worker:

```yaml
status: ready
automation: agent
```

Creating or editing any other record must not start implementation. The worker
claims a ready record by committing `status: in_progress` before it runs.

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
record directly with the checked-in helper:

```bash
node .github/scripts/workbench-publish.cjs \
  /absolute/path/to/local-record.md \
  issues/<feature>/<issue>.md \
  "issues: update <feature>/<issue>"
```

For coordinated multi-file restructuring, use a focused Workbench branch and
PR. Never mix Workbench files into a Nook implementation PR.

## Team safety

Before editing a record, inspect its status, owner, updated timestamp,
dependencies, related PRs, and recent worklogs.

Agents must not:

- claim or reassign another active owner's `in_progress` work;
- mark acceptance criteria done without validation evidence;
- delete prior findings, failed approaches, blockers, or decisions;
- switch `automation: agent` or `status: ready` merely to organize a draft;
- copy prompts, chats, credentials, secrets, vault data, private user
  information, environment values, or raw logs into the Workbench.

When overlap is uncertain, append the finding to the likely issue and leave it
`proposed` rather than creating a competing execution record.

## Worklog requirement

Every task-owning agent must publish one worklog before reporting completion or
a blocker, even when the task began from a direct user prompt and had no issue.
Use `worklogs/_templates/worklog.md`. Include:

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
- the new worklog;
- the Nook implementation PR;
- what was completed versus what remains.

Re-open the published files before handoff and verify the links and state are
visible on Workbench `main`.
