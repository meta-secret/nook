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

- A child worker is not another delivery owner.
- The task owner may assign a bounded child worker:
  - an exact immutable baseline;
  - a read-only evidence surface; or
  - an isolated and disjoint write scope.
- The child returns its result to the task owner.
  - It must not mutate Workbench, branch, PR, review, check, or merge state.
  - Its ownership ends when the result is handed back.

See [subagent-delegation.md](../workflows/subagent-delegation.md).

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
- a bounded worker assigning its own PR to the continuing owner and posting a
  direct mention;
- repository automation acting within its documented machine-owned scope.

For a bounded worker:

- an issue-backed run takes the continuing owner from the claimed Workbench
  issue;
- a prompt-backed run requires the `continuing_owner` workflow input;
- the continuing owner must be a Nook GitHub collaborator with write access;
- the workflow assigns the PR to that owner;
- the workflow posts a direct mention before it exits;
- the generated PR records that owner and the exact owned scope.

## Examples

- Before: an agent finds a related PR that it does not own.
- It pushes fixes to that PR.
- It resolves the PR's review threads.
- It prepares the PR for merge.
- After: the agent records the overlap.
- It leaves the PR untouched.
- It continues only its assigned feature.
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

- Review the task plan, Workbench owner, branch, and pull request together.
  - They must identify one coherent owned scope.
- Run `task loom:cortex-audit` after guidance changes.

The repository preflight contract must retain the ownership guard in:

- `.cortex/AGENTS.md`;
- `.cortex/teams/ai/workflows/coding-bro.md`;
- `.cortex/teams/ai/workflows/issues.md`.
