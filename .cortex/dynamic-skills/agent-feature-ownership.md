# Agent Feature Ownership

## Purpose

Prevent concurrent agents from mutating the same feature, issue, branch, or
pull request.

Each agent works only inside its explicitly assigned feature and focused issue
set.

## Problem Pattern

An agent notices an open issue or pull request owned by another active task.

It then changes that work without a handoff. Examples include:

- editing the other task's branch;
- pushing commits to its pull request;
- replying to or resolving its review threads;
- changing labels or workflow state;
- closing, reopening, or merging its pull request;
- claiming or completing its Workbench issues.

These actions create conflicting task state. They can also invalidate the real
owner's local work and validation evidence.

## Preferred Pattern

Establish ownership before the first mutation.

An agent owns only:

- the direct user task assigned to it;
- the Workbench feature and focused issues it explicitly claimed;
- branches and pull requests created for that owned scope;
- artifacts explicitly handed to it by the user, task owner, or orchestrator.

Treat every other active task as foreign work.

For foreign work, an agent may:

- inspect public state read-only to detect overlap;
- report a conflict or finding to the owner;
- wait for an explicit handoff.

It must not mutate the foreign task's files, Workbench records, branch, pull
request, comments, labels, checks, or merge state.

Before each push, review resolution, close, reopen, or merge action:

1. Confirm the branch and pull request belong to the owned issue set.
2. Confirm no other active agent owns that feature or issue.
3. Stop when ownership is missing or ambiguous.
4. Request or await an explicit handoff.

An explicit handoff transfers the named feature or focused issues. It does not
transfer unrelated work from the previous owner's queue.

## Scope

Applies to:

- all agent-driven Nook and Workbench changes;
- shared worktrees and independent worktrees;
- interactive agents, scheduled agents, and recovery agents;
- issue, branch, pull-request, review, check, and merge operations.

Does not apply to:

- read-only inspection used to avoid overlap;
- an explicit user, owner, or orchestrator handoff;
- a bounded worker handing its own PR to the continuing owner named in the PR's
  `## Ownership` section;
- repository automation acting within its documented machine-owned scope.

For a bounded worker:

- an issue-backed run takes the continuing owner from the claimed Workbench
  issue;
- a prompt-backed run requires the `continuing_owner` workflow input;
- the generated PR records that owner and the exact owned scope.

## Examples

- Before: an agent finds a related PR, pushes fixes to it, resolves its threads,
  and prepares to merge it without owning its issue.
- After: the agent records the overlap, leaves the PR untouched, and continues
  only its assigned feature.
- Before: an agent closes another task's PR because it interprets a new request
  as cancellation.
- After: only the owning agent changes that PR after the user explicitly
  changes the owned task.

## Application Checklist

- [ ] Identify the assigned feature and focused issue set.
- [ ] Map owned branches and pull requests to those issues.
- [ ] Inspect other active work read-only for overlap.
- [ ] Leave foreign branches, PRs, reviews, checks, and records unchanged.
- [ ] Require an explicit handoff before ownership changes.
- [ ] Recheck ownership before every remote mutation.

## Validation

Review the task plan, Workbench owner, branch, and pull request together.

They must identify one coherent owned scope.

Run `task loom:cortex-audit` after guidance changes.

The repository preflight contract must retain the ownership guard in:

- `.cortex/AGENTS.md`;
- `.cortex/workflows/coding-bro.md`;
- `.cortex/workflows/issues.md`.
