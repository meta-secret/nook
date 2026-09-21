# Feature Pull-Request Delivery

## Status and authority

This is the canonical delivery contract for feature work. The repository has
one permanent delivery branch: `main`. Every feature uses a short-lived feature
branch created from freshly fetched `origin/main`.

The owning Feature Gizmo carries one delivery cycle from implementation through
the merged pull request. There is no `dev` integration branch, snapshot
publication stage, promotion stage, or separate Feature Gizmo delivery cycle.

Read the complete [multiagent delivery visual
model](multiagent-delivery-diagrams.md) before using this contract.

## Ownership

- Gizmo Prime remains the mission/root coordinator.
- The Feature Gizmo owns implementation, repair, readiness, and final delivery.
- The single Team Gizmo coordinates bounded workers.
- The upstream integration agent owns local workspace setup, branch integration,
  combined validation, and cleanup.
- Team Gizmo (Delivery Pipeline context) routes GitHub mechanics to PR Lifecycle Agent.
- PR Lifecycle Agent pushes the canonical feature branch, creates or updates
  its pull request, observes checks, performs the authorized squash merge, and
  deletes the remote feature branch.
- Reviews may improve the change, but missing review or approval is never a
  delivery blocker. The owning Feature Gizmo may merge its own pull request.

## Fresh-main bootstrap

Before planning, delegation, worktree creation, or edits, Gizmo Prime runs
`git fetch --prune origin`. A fetch failure fails the run closed.

Prime selects the freshly fetched `origin/main` as the base branch supplied to
the upstream local feature workflow. Every new canonical feature branch starts
from that base. No local `dev`, remote `dev`, previously pinned base, or other
branch may substitute for it.

The canonical feature branch name is workflow authority. Observed base and head
SHAs are delivery evidence. Before review, PR mutation, check observation, or
merge, PR Lifecycle re-fetches and resolves a stable committed feature head.
A branch advance invalidates head-bound review and check evidence. Delivery
follows the latest head and reruns the affected checks.

## Required actions

### Feature implementation

- Apply the upstream [local feature workflow](../../../.meta-cortex/agents/teams/delivery-team/integration-agent/skills/local-feature/SKILL.md).
- Use one canonical feature branch for the feature.
- Keep worker branches local.
- Author meaningful Rust behavior tests and targeted web flow tests with the
  implementation.
- Permit only the scoped local feedback authorized by the owning language
  policy. Product validation runs in the pull request.

### Pull request

1. Push the canonical feature branch.
2. Create or update one pull request from that branch into `main`.
3. Run every required PR check for the current head.
4. Wait until all required checks reach a terminal state.
5. If any required job fails or is cancelled, collect the complete terminal
   inventory before repair.
6. Route the complete diagnostics to Gizmo Prime.
7. Repair all known failures in one coherent wave.
8. Push the repaired feature head and rerun the complete required check set.
9. Repeat until every required check is green for the unchanged current head.

Review requests and approvals are optional. Unresolved security findings or
known correctness defects still block readiness. Absence of a reviewer,
approval, or review count does not block the owning Feature Gizmo.

### Merge and cleanup

1. Re-fetch `origin/main` and the canonical feature branch.
2. Require every required PR check to be green for the current feature head.
3. If `origin/main` advanced, update the feature branch from the new main
   frontier without force-pushing.
4. Rerun every invalidated required check.
5. Authorize PR Lifecycle Agent to squash-merge the pull request into `main`.
6. Verify that GitHub reports the pull request as merged.
7. Verify that `origin/main` contains the squash result.
8. Delete the remote feature branch after the merge.
9. Confirm local worker cleanup through the upstream integration agent.

The merge method must keep `main` linear. Squash merge is the canonical method.
Repository settings must allow squash merging, disable merge commits, and
delete head branches automatically after merge. Rebase merge may remain
disabled when squash merge is available.

## Repair procedure

1. Wait for the entire required PR check wave to finish.
2. Collect every failed or cancelled required GitHub Actions job.
3. Include the current feature head and actionable diagnostics.
4. Group diagnostics by owning team and coherent competence area.
5. Dispatch one consolidated repair packet per area.
6. Integrate the complete repair wave into the canonical feature branch.
7. Push once after the coherent wave is integrated.
8. Rerun the full required PR check set.

Do not notify, repair, push, or rerun after each individual diagnostic. A new
terminal failure wave starts a new complete inventory and repair cycle.

## Prohibited actions

- Do not create, restore, publish, validate, or promote a `dev` branch.
- Do not invoke or preserve retired `dev:*` delivery commands.
- Do not split feature implementation and final delivery between separate
  feature and manager agents.
- Do not create merge commits on `main`.
- Do not force-push delivery branches.
- Do not bypass required PR checks.
- Do not treat optional review or approval as a required gate.
- Do not manually close a pull request and report it as merged.
- Do not leave the remote feature branch behind after a successful merge.

## Evidence

Successful delivery reports:

- the canonical feature branch;
- the fresh `originMainSha` base;
- the final tested feature head;
- the pull-request identity;
- terminal results for every required PR check;
- the squash-merge result on `origin/main`;
- GitHub's merged PR state; and
- successful remote feature-branch deletion.

An implementation commit, a pushed branch, a green subset of checks, or a
closed-but-unmerged pull request is not delivery completion.
