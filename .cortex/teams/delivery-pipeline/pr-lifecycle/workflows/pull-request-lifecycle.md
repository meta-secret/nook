# Feature Pull-Request Lifecycle

## Outcome

One canonical feature branch becomes one squash commit on `main`. The remote
feature branch is deleted after merge.

## Procedure

1. Load the [authorization packet](authorization-handshake.md) and Nook's
   [feature-delivery policy](../../../../gizmo-prime/architecture/dev-delivery.md).
2. Apply upstream
   [Pull Request Delivery](../../../../../.meta-cortex/teams/delivery-team/agents/pr-agent/skills/pull-request-delivery/SKILL.md)
   for publication, check observation, authorized merge, and remote cleanup.
3. Use the Nook event subscriber below for live observation. Route workflow
   execution or rerun needs through Team Gizmo to upstream CI/CD with SRE context.
4. Return the complete required-check inventory and the authorized operation's
   actual result. Report merge and cleanup results separately.

Reviews and approvals are optional. The owning Feature Gizmo may merge its own
pull request. Required checks and unresolved known defects remain mandatory.

**Prohibited:** substitute an upstream example's merge strategy for Nook's
squash policy, or report only the first failed job.

**Preferred:** gather the complete terminal check inventory, coordinate one
repair wave, and merge only under Nook's unchanged-head delivery requirements.

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
