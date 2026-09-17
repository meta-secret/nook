# Workbench Issue Management

Use this workflow when work discovers missing functionality that will not be
completed in the current PR. Record the remaining work in the existing or new
focused issue instead of hiding it in chat or a PR summary.

Nook issues live as versioned Markdown in
[`meta-secret/nook-workbench`](https://github.com/meta-secret/nook-workbench).
GitHub Issues are historical input, not the current execution record.
Workbench stores feature summaries and issue lifecycle records only.

## Required actions

### Identify and search for deferred work

Apply this workflow before describing discovered work as too large, too risky,
out of scope, a follow-up, unimplemented, future work, or blocked. Also apply
it when implementation, review, or tests discover work that the current PR
will not finish.

1. Ask Delivery Pipeline Team Gizmo to route an issue-search packet through the
   active harness to the PR Lifecycle Agent.
2. The PR Lifecycle Agent clones or updates the Workbench outside the Nook
   working tree.
3. Search feature summaries and issue files with both product language and
   code terms. Search only `issues/`:

   ```bash
   workbench_dir="$(mktemp -d)"
   gh repo clone meta-secret/nook-workbench "$workbench_dir"
   rg -n -i "<user words>|<code terms>" "$workbench_dir/issues"
   ```

4. Do not infer current state from a historical Nook GitHub issue alone.
   Imported issue records link their original issue bodies and comments. The
   Workbench issue is the mutable execution record.

### Keep feature summaries and focused issues discoverable

Each feature has a `README.md` and focused issue files:

- The feature README replaces a GitHub milestone and aggregate issue.
- Focused issue files replace sub-issues.

The feature README records:

- the complete user-visible or operational outcome;
- the focused issue index;
- dependencies between capabilities;
- stable public or cross-module interfaces;
- feature-level acceptance criteria; and
- current completion status.

Feature completion follows [dev delivery](../architecture/dev-delivery.md).
The manager's dev PR aggregates selected complete features.

- Create the feature README before its first focused issue.
- Keep focused issues linked from the feature index.
- Keep unrelated work out of a flat `backlog` area. The `backlog` area is
  primarily for historical imports.

### Maintain focused issue records

Every focused issue follows `issues/_templates/issue.md` and includes:

- YAML frontmatter for title, lifecycle status, priority, automation mode,
  owner, timestamps, source issues, related PRs, and dependencies;
- context and an observable outcome;
- explicit included and excluded scope;
- testable acceptance criteria and required coverage;
- append-only progress, findings, and durable decisions; and
- links to relevant Nook code, PRs, and historical discussions.

Valid statuses are `proposed`, `ready`, `in_progress`, `blocked`, `done`, and
`cancelled`. The `automation` value is `manual` or `agent`.

The `gizmo_id` field is optional:

- The owning Gizmo assigns it when issue routing needs that metadata.
- When present, it is canonical lowercase-hyphenated routing metadata with
  valid syntax.
- Do not change it to create a fresh identity.
- Legacy issues may omit it.

### Dispatch eligible issues

An issue is eligible for explicit dispatch to a bounded Nook implementation
worker only when it has all of these values:

```yaml
status: ready
automation: agent
owner: <nook-github-collaborator>
```

- The owner must be an assignable Nook GitHub collaborator with write access.
- Provide exactly one of `issue_path` or `prompt` in the dispatch.
- An `issue_path` dispatch resolves only the exact requested path.
- A missing or unassigned owner fails without implementation.
- Each explicit dispatch creates its own workflow run.
- The Workbench blob SHA prevents concurrent claims of the same issue.
- Before implementation begins, the worker commits the issue with
  `status: in_progress`.
- Creating or editing a feature README or a different issue does not start
  implementation. Only explicit dispatch of the exact eligible issue does.

### Choose whether to update or create

- **Update an existing issue:** Choose it when it already owns the broad
  problem or focused deliverable.
  - Preserve its progress, findings, decisions, links, and acceptance criteria.
  - Add progress rather than erasing history.
- **Create a feature directory:** Do so only when no existing feature owns the
  work.
- **Create a focused issue:** Do so only when no existing issue owns the
  deliverable.
- **Set initial status:** Leave a newly created issue in `proposed` unless it
  is ready for an explicit dispatch.

Features may proceed concurrently when their scopes and dependencies allow.

### Publish issue changes

1. The owning Gizmo authors the issue content and lifecycle state.
2. Route the single-issue publication packet through the active harness.
   - Delivery Pipeline Team Gizmo sends it to the PR Lifecycle Agent.
   - The PR Lifecycle Agent executes the checked-in helper without changing
     the authored content.
3. When updating an existing issue, protect the edit against concurrent
   changes:
   - Read the current file and retain the Workbench blob SHA on which the local
     edit is based.
   - Read and merge concurrent progress before publishing. Do not overwrite it.
   - Pass the exact blob SHA as `NOOK_WORKBENCH_EXPECTED_SHA`:

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

   The helper rejects the update when the expected SHA is absent or no longer
   current.
4. Publish a new issue only at a path that does not already exist.
   - Omit `NOOK_WORKBENCH_EXPECTED_SHA` for a new path.
   - Do not replace an existing issue when creating a record.

Publication does not transfer issue authorship or lifecycle decisions to the
PR Lifecycle Agent.

### Preserve issue ownership and lifecycle evidence

- **Before editing:** Inspect the issue's status, owner, updated timestamp,
  dependencies, related PRs, and existing progress.
- **Ownership:**
  - When no active owner exists, add a finding to the likely issue.
  - A related scope does not transfer ownership.
  - Another agent may change a feature or its focused issues only after an
    explicit user, owner, or orchestrator handoff. See
    [agent feature ownership](../dynamic-skills/agent-feature-ownership.md).
- **Progress:**
  - Record implementation progress and findings in the issue's append-only
    history.
  - Mark acceptance criteria done only with validation evidence.
  - Use `blocked` for a concrete external blocker.
  - The owning Gizmo decides issue status and `related_prs`.
- **Final handoff:**
  - Link the canonical focused issue when deferred work remains.
  - State remaining work only when the work is incomplete.

## Prohibited actions

Agents must not:

- treat a historical GitHub Issue as the current mutable execution record;
- claim or reassign another active owner's `in_progress` issue;
- mutate another active task's branch or pull request;
- reply to or resolve another active task's reviews;
- trigger another active task's checks;
- change another active task's merge state;
- mark acceptance criteria done without validation evidence;
- delete prior findings, failed approaches, blockers, or decisions;
- change `automation: agent` or `status: ready` merely to organize a draft;
- copy or lightly reformat prompts or chats into the Workbench; or
- store credentials, secrets, vault data, private user information,
  environment values, or raw logs in an issue.

When an issue overlaps another active owner, report the finding without
changing that owner's issue.
