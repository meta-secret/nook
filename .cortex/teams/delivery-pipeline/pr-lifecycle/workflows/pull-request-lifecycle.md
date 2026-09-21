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
8. Wait for the upstream integration agent to return the repaired feature
   branch, integration outcome, and checks, then push the new head.
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

## Required actions

### Observe pull-request events

1. Start the live subscription from the active PR Lifecycle Agent task.

   ```bash
   bun agentic-ai/loom/src/pr-steward-events.ts --pr <number>
   ```

   Run the direct Bun process in the foreground. Keep it attached to the
   current pull request while observing required checks.
2. Read newline-delimited JSON from standard output.
   - Each line is one closed `pr-steward-ndjson/v2` envelope.
   - Deploy its writer and reader atomically. No compatibility reader exists.
   - A version mismatch fails closed. Stop the subscriber and report a blocker.
   - Treat notifications as bounded observation hints.
   - Re-fetch authoritative pull-request, head, and check state before acting.
3. End the observation iteration after all required checks reach terminal
   state.
   - If the feature head advances, discard head-bound evidence.
   - Start a fresh observation iteration for the new head.

The subscriber does not decide readiness or merge authority. The Feature Gizmo
retains the full delivery decision.

## Failure handling

- A partial check inventory is incomplete.
- A closed-but-unmerged PR is not delivery.
- A successful merge without remote branch deletion is incomplete cleanup.
- A merge commit on `main` violates the linear-history policy.
- A concurrent main change requires fresh ancestry handling and rerun evidence.
