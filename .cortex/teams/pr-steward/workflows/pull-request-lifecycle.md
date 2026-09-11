# Pull-Request Lifecycle

PR Steward performs the mechanical pull-request lifecycle after Gizmo Prime
has prepared a coherent exact head and supplied an operation packet.

## Outcome

The named pull-request operation completes against the packet's exact head.
PR Steward returns observable evidence or a bounded blocker.

## Inputs

- one repository and base ref;
- one branch and pull-request number;
- one expected head SHA;
- one named operation; and
- the evidence that Gizmo requires.

## Procedure

1. **Confirm the live target.** Re-read the pull request and compare the live
   repository, base, branch, number, and head with the packet.
   - Stop and report a blocker when any identity or head differs.
2. **Update pull-request metadata.** Create or update the title and
   description from the parent packet.
   - Keep the metadata faithful to the current diff and canonical pull-request
     contract.
3. **Observe review state.** Request the authorized review path and collect
   submitted review bodies, inline conversations, top-level comments, and
   unresolved threads.
   - Preserve complete observations in evidence. Return new or changed items
     with references, without technical adjudication.
4. **Observe validation state.** Collect failed checks, running checks,
   deployments, mergeability, and bounded wait outcomes for the exact head.
   - A selected successful job does not hide another required running or
     failed result.
5. **Retrigger named validation.** Dispatch only the exact-head validation
   operation named by Gizmo.
   - A retrigger does not authorize a new head or a new validation scope.
6. **Collect readiness evidence.** Run the read-only readiness evidence
   command when Gizmo requests it.
   - Return the command result as evidence. Gizmo decides readiness.
7. **Execute authorized merge.** Recheck the separate merge packet and run
   `gh pr merge <number> --squash` only when every named remote precondition
   still matches.
   - For the path-excluded route, run
     `gh pr merge <number> --squash --admin` only with a separate admin-merge
     packet.
   - This is the established path-excluded merge route. It is not a fallback
     or a generic bypass.
   - The packet must prove that the pull-request path policy intentionally
     excludes the ruleset-required preview deployment.
   - The packet must include passing exact-head checks and
     `task pr:ready PR=<number>` evidence.
   - Do not use this route when an applicable check, deployment, or review is
     failed or unresolved.
8. **Verify the remote result.** Confirm the pull request is merged and return
   the resulting commit, URL, run identifiers, and observed head.

## Failure handling

- A missing packet is a blocker for the named operation.
- A stale head or identity mismatch is a blocker for the named operation.
- An unavailable remote result is a blocker for the named operation.
- A failed required check is a blocker for the named operation.
- A missing applicable deployment is a blocker for the named operation.
- An unresolved review thread is a blocker for the named operation.
- Missing ruleset-required preview deployment needs path-policy evidence before
  the path-excluded route can be considered.
- A path-excluded admin merge needs a passing `task pr:ready` result.
- Report the smallest useful evidence for the blocker.
- Do not invent a retry, broaden the operation, or create a fallback path.
- Gizmo decides whether to route a correction, issue a fresh packet, or stop.

## Reactive observation

Gizmo may run PR Steward as a mission-scoped child while delivery is active.

### Required actions

1. Start the live subscription from the active PR Steward task.

   ```bash
   bun agentic-ai/loom/src/pr-steward-events.ts --pr <number>
   ```

   Run this direct Bun process in the child task's foreground PTY. Do not place
   a package-script wrapper between Gizmo and the subscriber.

   The default credential path is
   `~/.nook/events/pr-steward-client.yaml`. Use
   `--config <absolute-path>` after the PR number for an explicit override.

2. Read newline-delimited JSON from standard output.
   - Each line is one closed `pr-steward-ndjson/v2` envelope.
   - Deploy its writer and reader atomically. No compatibility reader exists.
   - A version mismatch fails closed. Stop the subscriber and report a blocker.
     Never mix writer and reader versions or start a predecessor path.
   - Observe only the assigned `meta-secret/nook` pull request through the
     fixed read-only GitHub capability.
   - Emit only exact-current-head routes. Suppress foreign or stale events.
   - Repository-managed ingress configuration includes workflow-job events.
     This observer emits no v2 record for them. Unique PR association belongs
     to later reconciliation.
   - Keep a rejected or missing event URL rejected. Do not substitute the
     assigned pull-request URL.
   - Emit a sanitized blocker when assigned-PR observation is unavailable.
   - Suppress foreign or unattributable malformed input.
   - Emit a sanitized blocker for attributable malformed input, then continue.
   - Treat the notification as a prompt to perform only the next operation
     that Gizmo authorizes.
3. Stop when Gizmo directs the child to finish.
   - Send Ctrl-C to the same foreground PTY. The direct process receives
     `SIGINT`, drains NATS, and exits with status zero.
   - An operating-system termination may use `SIGTERM` against the direct
     process.
   - Wait for exit before Gizmo finishes. A nonzero result is a blocker.

### Subscription boundary

- The client connects to `wss://events.dev.nokey.sh` with trusted TLS.
- It subscribes directly to `default.github-webhook.pr-lifecycle`.
- It uses no queue group. Concurrent Gizmo missions each receive the live
  event.
- Each Gizmo owns its own child and assigned PR filter. One Gizmo never stops,
  switches, or consumes another Gizmo's subscription.
- The subscription is Core NATS live fan-out. It does not bind the shared
  durable work-queue consumer.
- JetStream persistence serves the platform. It does not make this ephemeral
  child replay missed notifications.
- Missed and duplicate notifications are acceptable hints.
- One child never changes its assigned PR dynamically.
- Gizmo must reconcile the final GitHub state directly before its readiness
  or completion verdict.

### Output contract

The observer retains fingerprints of the last 128 successfully emitted payloads.
An identical byte payload is suppressed before another GitHub read. Changed
envelopes remain observable even when their meaning is unchanged. Blockers are
not cached. This bounded memory is process-local and never persisted.

Output contains only bounded hints. It never contains bodies, review text,
logs, raw payloads, or credentials. Steward performs authorized reconciliation
from these hints. The subscriber does not summarize or decide readiness.

### Active-task waiting

- Let the subscriber wait on NATS without periodic output.
- Use a harness wait that wakes on output when available.
- Otherwise use the longest bounded PTY read allowed by the host.
- An empty read is not a state change. Do not notify Gizmo or query GitHub.
- Reconcile relevant hints only within the current operation packet.
- Keep one initial observation and the required final direct reconciliation.
- Report a new blocker, changed actionable result, or terminal outcome once.
- Do not repeat unchanged evidence or wake Gizmo for transport activity.

### Live reactive pipeline canary

This diagnostic-only canary proves that one active PR can reach its Steward.
Run it only when assigned to diagnose the subscription.

1. Confirm the scoped credential file and exact pull-request number exist.
2. Start the documented direct Bun subscription in the foreground PTY.
3. Read the child PTY using the active-task waiting rules above.
   - Notify Gizmo only when matching NDJSON or a new blocker arrives.
4. Correlate its `deliveryId` across GitHub, Argo, and the NATS envelope.
5. Have PR Steward send the bounded matching notification to Gizmo.
6. Have Gizmo perform a bounded direct GitHub reconciliation.
7. After terminal state, send Ctrl-C to the same PTY.
   - Require the NATS drain and process exit to complete with status zero.

## Validation

- Every external mutation used the packet's repository, pull request, and
  exact head.
- Review and check observations were returned without technical adjudication.
- Bounded waits stayed inside the active task.
- A merge result is a verified squash merge when merge was authorized.
- An administrator merge used the path-excluded route only with its separate
  Gizmo packet and exact-head evidence.
- Gizmo's terminal decision used a direct GitHub reconciliation instead of
  notification history.
