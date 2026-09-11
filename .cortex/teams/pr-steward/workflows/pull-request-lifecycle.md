# Pull-Request Lifecycle

PR Steward performs the mechanical pull-request lifecycle after Gizmo Prime
has prepared a coherent exact head and supplied an operation packet.

## GitHub operations outside a pull request

- Execute repository discovery, authentication checks, workflow-run queries,
  and logs only for the target named in the parent packet.
- Execute GitHub-backed Task, Loom, and script commands on behalf of Gizmo.
- Assemble GitHub statistics from parent-provided inputs and return the artifact.
- Publish Workbench content only when Gizmo supplies the exact source and path.
- Preserve expected-blob checks and return conflicts without editing the record.
- Gizmo retains content authorship, interpretation, and lifecycle decisions.

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

Gizmo starts a fresh PR Steward child for each check-observation iteration.
Each child subscribes before reading its initial GitHub snapshot. That snapshot
freezes the iteration head. A changed head is a blocker, never a new assignment.

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
3. Stop when iteration checks complete, the PR closes, or Gizmo directs.
   - For a requested stop, send Ctrl-C to the same foreground PTY. It receives
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
envelopes remain observable even when their meaning is unchanged. Failed
deliveries remain eligible for fresh observation. Repeated blockers with the
same code, target, source, head, and summary emit once. Successful routing
clears that suppression so a later recurrence is visible. Event identifiers
do not define a blocker change. This bounded memory is never persisted.

Output contains only bounded hints. It never contains bodies, review text,
logs, raw payloads, or credentials. Steward performs authorized reconciliation
from these hints. The subscriber does not summarize or decide readiness.

### Active-task waiting

- Keep the subscription active during one check-observation iteration.
- Read an initial snapshot after subscribing. Already-completed checks can end
  the iteration immediately.
- Valid, newly routed current-head notifications reset the inactivity deadline.
  Suppressed duplicate payloads, stale events, and foreign traffic do not reset it.
- Current-head check-run, check-suite, and workflow-run hints trigger a fresh
  completion snapshot. Other valid routes reset inactivity without that query.
- The process checks elapsed time against the last relevant notification.
  Only more than five minutes without one permits an idle completion query.
- An incomplete snapshot stays silent. After an idle query, wait another five
  minutes before another idle query. Do not create a hot loop or wake reasoning.
- Event activity invalidates an in-flight idle result. Check observations never
  overlap. Stop clears the timer and invalidates pending completion callbacks.
- A nonempty rollup completes when every check has a terminal result.
  Failed conclusions complete the iteration too. They do not establish readiness.
- Empty rollups remain pending. Unknown states or unavailable evidence fail closed.
  One GraphQL snapshot uses complete aggregate counts instead of paginated nodes.
  The rollup commit must equal the snapshot head. Group totals must match counts.
- Completion drains NATS, then emits one line on stderr with the outcome, PR URL,
  exact head, total count, failed count, and unknown-conclusion count. Standard output stays v2 NDJSON.
- A merged or closed PR stops the child with that distinct outcome. It never
  substitutes a closure result for completed checks.
- After successful exit, send one compact handoff to Gizmo and end the child.
  Gizmo acts on the result and starts a fresh child for another iteration.
- Gizmo retains final direct reconciliation, readiness, and merge authority.
- Use a harness wait that wakes on output when available. Otherwise use the
  longest host-bounded PTY read. Empty reads produce no messages or GitHub queries.

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
