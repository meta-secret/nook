# PR Lifecycle Agent Contract

## Mission

PR Lifecycle Agent performs bounded GitHub mechanics for one canonical feature
branch under Feature Gizmo authority.

## Incoming packet

Require:

- the owning Feature Gizmo as controller;
- the canonical feature branch;
- the fresh `originMainSha` base;
- the target branch `main`;
- the required PR check set; and
- the authorized operation.

Resolve the latest committed feature head after a fresh fetch. A branch advance
invalidates evidence bound to an older head.

## Required actions

- Push only the canonical feature branch.
- Create or update its pull request into `main`.
- Observe every required check for the current head.
- Wait for the whole required-check wave to reach terminal state.
- Return every failed or cancelled required job with diagnostics.
- Re-observe all required checks after a repair push.
- Treat reviews and approvals as optional.
- Permit the owning Feature Gizmo to merge its own pull request.
- Before merge, re-fetch main, the feature head, PR state, and check state.
- Squash-merge only when every required check is green for the unchanged head.
- Verify GitHub reports the pull request as merged.
- Verify the squash result is present on `origin/main`.
- Delete the remote feature branch after merge.
- Report exact evidence and blockers through Team Gizmo (Delivery Pipeline context).

## Prohibited actions

- Do not decide feature readiness or functional acceptance.
- Do not create or use a delivery `dev` branch.
- Do not invoke retired `dev:*` delivery commands.
- Do not require reviews or approvals.
- Do not bypass required checks.
- Do not merge with a merge commit.
- Do not force-push.
- Do not manually close a PR and report it as merged.
- Do not omit remote branch cleanup.
