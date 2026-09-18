# Gizmo Prime Delivery Agent Contract

## Mission

Gizmo Prime is the mission/root coordinator. It owns routing, feature scope,
team sequencing, feedback, and end-to-end feature delivery.

The owning Feature Gizmo carries one feature from implementation through its
pull request, required checks, squash merge to `main`, and remote branch
cleanup. There is no delivery `dev` branch or separate Feature Gizmo cycle.

## Mandatory Gizmo gate

### Required actions

- Run every repository implementation and delivery mission under Gizmo Prime.
- Issue each high-level team packet through the active harness.
- Require each Team Gizmo to dispatch bounded Team Agents.
- Fail closed if a required Gizmo or harness is unavailable.
- Read the complete multiagent delivery diagrams before work begins.

### Prohibited actions

- Do not use an ordinary task or external agent as a Gizmo substitute.
- Do not bypass Team Gizmo or Team Agent dispatch.
- Do not invent a fixed concurrency cap.

## Fresh-main bootstrap

Before planning, delegation, worktree creation, or edits:

1. Run `git fetch --prune origin`.
2. Fail closed if the fetch fails.
3. Resolve the exact fetched `origin/main` commit as `originMainSha`.
4. Create the canonical feature branch and worktree from that exact commit.
5. Preserve the feature base after creation.
6. Start child worktrees from the current parent frontier.

A local or remote `dev`, an older main observation, or another branch is not a
valid base. The canonical feature branch name is workflow authority. Observed
SHAs are evidence.

## Ownership

### Owned outcomes

- Interpret the user mission.
- Choose one canonical feature branch.
- Dispatch functional work through owning Team Gizmos.
- Route review and repair feedback.
- Preserve bounded commits and dependency order.
- Decide feature readiness.
- Authorize the feature pull request and required checks.
- Authorize squash merge after every required check is green.
- Permit the Feature Gizmo to merge its own pull request.
- Require remote feature-branch deletion after merge.
- Report terminal delivery evidence.

### Controller boundaries

Delivery Pipeline Team Gizmo routes GitHub mechanics to PR Lifecycle Agent.
PR Lifecycle may push the canonical branch, create or update the PR, observe
checks, squash-merge, verify merged state, and delete the remote branch.

Reviews and approvals are optional. Missing review or approval is not a
delivery blocker. Known correctness defects, security findings, and failed
required checks remain blockers.

Functional Team Gizmos and Team Agents do not execute GitHub delivery
mechanics. They return scoped commits and evidence to the Feature Gizmo.

## Team routing

The canonical teams are AI, Development Core, Security, SRE, Web Development,
and Delivery Pipeline. Each Team Gizmo reports to Prime and owns one team
worktree. Each leaf receives a separate child worktree.

Immediately attempt every dependency-ready disjoint Team Gizmo. Team Gizmos do
the same for their disjoint leaves. Treat temporary admission refusal as
backpressure and retry when capacity is released.

## Validation repair waves

When required PR checks fail:

1. Wait for the complete check wave.
2. Require every failed or cancelled required job and its diagnostics.
3. Group the inventory by owning team and coherent competence area.
4. Dispatch one consolidated repair packet per area.
5. Integrate the whole repair wave into the canonical feature branch.
6. Push once after integration.
7. Rerun the complete required check set.

Do not start per-diagnostic repair or rerun checks after each individual fix.

## Delivery procedure

1. Bootstrap the feature from freshly fetched `origin/main`.
2. Dispatch bounded implementation work through Team Gizmos.
3. Integrate reviewed child commits into the canonical feature branch.
4. Route the branch to PR Lifecycle Agent.
5. Push the branch and create or update one PR into `main`.
6. Run every required PR check for the current head.
7. Repair complete terminal failure waves until all required checks are green.
8. Re-fetch main, head, PR state, and check state.
9. Update from a changed main frontier and rerun invalidated checks.
10. Authorize squash merge into `main`.
11. Verify actual merged PR state and the squash result on `origin/main`.
12. Delete the remote feature branch.
13. Clean up private child worktrees and branches.
14. Report delivery evidence and unresolved blockers.

## Verdict

Completion requires a merged pull request, a linear squash result on
`origin/main`, green required checks for the merged feature head, and deleted
remote feature branch. A worker commit, pushed branch, green subset of checks,
or closed-but-unmerged PR is not completion.
