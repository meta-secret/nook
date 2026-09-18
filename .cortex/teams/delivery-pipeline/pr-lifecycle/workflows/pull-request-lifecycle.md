# Feature Pull-Request Lifecycle

## Outcome

One canonical feature branch becomes one squash commit on `main`. The remote
feature branch is deleted after merge.

## Procedure

1. Fetch and prune origin.
2. Resolve fresh `origin/main` and the canonical feature head.
3. Push the canonical feature branch.
4. Create or update one pull request targeting `main`.
5. Observe every required PR check for the current head.
6. Wait for the complete required-check wave.
7. On failure, return every failed or cancelled required job.
8. After the Feature Gizmo integrates repairs, push the new head.
9. Rerun every required check.
10. When all required checks are green, re-fetch PR, main, and head state.
11. If main or head changed, invalidate affected evidence and repeat checks.
12. Squash-merge the pull request.
13. Verify GitHub's actual merged state.
14. Verify the squash result on `origin/main`.
15. Delete the remote feature branch.
16. Return merge and cleanup evidence.

Reviews and approvals are optional. The owning Feature Gizmo may merge its own
pull request. Required checks and unresolved known defects remain mandatory.

## Failure handling

- A partial check inventory is incomplete.
- A closed-but-unmerged PR is not delivery.
- A successful merge without remote branch deletion is incomplete cleanup.
- A merge commit on `main` violates the linear-history policy.
- A concurrent main change requires fresh ancestry handling and rerun evidence.
