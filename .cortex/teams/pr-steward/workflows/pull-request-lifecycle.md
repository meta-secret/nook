# Pull-Request Lifecycle

## Authority

PR Steward performs bounded mechanics under the
[authorization handshake](authorization-handshake.md). Feature Gizmos own
feature compilation and local integration decisions. The manually run dev
manager owns publication, slow PR validation, and promotion.

## Required actions

- Execute only the packet's repository, revision, task, and target.
- Invoke local integration only under the feature Gizmo's packet.
- Invoke snapshot publication and fast-forward promotion only under a dev-manager packet.
- Let the task enforce shared-checkout locking and revision guards.
- Return full review observations without deciding technical dispositions.
- Publish Workbench records only from exact parent-authored content.
- Keep shared Git mutations inside these bounded task invocations.

## Prohibited actions

- Do not decide readiness, feature scope, or promotion policy.
- Do not author functional fixes or create workers.
- Do not squash, rebase, force-push, or create a promotion merge commit.
- Do not use a stock PR merge method in place of fast-forward promotion.
- Do not close a PR manually to simulate merged status.
- Do not use administrator capability to skip required checks.
- Do not create a continuous manager, scheduler, or custom polling loop.

## Procedure

1. Confirm the packet's live target and expected SHA.
2. Execute the named operation.
   - Feature compilation uses remote build-only execution.
   - Local landing uses local integration with positive feature build evidence.
   - Manager publication uses snapshot publication.
3. The dev manager invokes `dev:pr-manager` to create or update one open
   dev-to-main PR. PR Steward only observes the resulting exact PR identity.
   - Use [PR metadata](../../../gizmo/workflows/pull-requests.md#pr-title-and-description).
   - A merged PR is never reused for a later cycle.
4. Request the full existing slow PR checks under the manager packet.
   - Preserve e2e opt-ins and security-required focused checks.
   - Freeze the captured dev SHA.
   - Return failed, running, and successful results without hiding any gate.
5. Collect review and security evidence for the manager's verdict.
6. Execute fast-forward promotion only under a separate promotion packet.
   - Require successful checks and verdicts for the unchanged dev SHA.
   - Require remote main ancestry.
   - Use the authorized publication identity through the guarded task.
7. Verify remote main equals the tested SHA.
8. Read actual remote PR status and return it separately.
   - If it is not merged, report that incomplete outcome.
   - Preserve permanent dev and newer local commits.

## Failure handling

- A missing packet, changed target, or unavailable evidence blocks the operation.
- Failed checks and unresolved review/security verdicts block promotion.
- Protection rejection is visible and never selects another merge method.
- Return repair evidence to the controller for the normal feature path.
- For every failed e2e test, return the evidence needed to analyze the
  underlying cause and route the repair to its owning boundary. Before fixing,
  the repair must write a focused unit test at that boundary. Direct e2e-test
  edits are allowed only when a unit test is infeasible (rare).
- Do not mutate scope or automatically retry publication under stale authority.

## Reactive observation

The controller starts a fresh PR Steward child for each check-observation iteration.
Each child subscribes before reading its initial GitHub snapshot. That snapshot
freezes the iteration head. A changed head is a blocker, never a new assignment.

### Required actions

1. Start the live subscription from the active PR Steward task.

   ```bash
   bun agentic-ai/loom/src/pr-steward-events.ts --pr <number>
   ```

   Run this direct Bun process in the child task's foreground PTY. Do not place
   a package-script wrapper between the controller and the subscriber.

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
     that the controller authorizes.
3. Stop when iteration checks complete, the PR closes, or the controller directs.
   - For a requested stop, send Ctrl-C to the same foreground PTY. It receives
     `SIGINT`, drains NATS, and exits with status zero.
   - An operating-system termination may use `SIGTERM` against the direct
     process.
   - Wait for exit before the controller finishes. A nonzero result is a blocker.

### Subscription boundary

- The client connects to `wss://events.dev.nokey.sh` with trusted TLS.
- It subscribes directly to `default.github-webhook.pr-lifecycle`.
- It uses no queue group. Concurrent controller missions each receive the live
  event.
- Each controller owns its own child and assigned PR filter. One controller never stops,
  switches, or consumes another controller's subscription.
- The subscription is Core NATS live fan-out. It does not bind the shared
  durable work-queue consumer.
- JetStream persistence serves the platform. It does not make this ephemeral
  child replay missed notifications.
- Missed and duplicate notifications are acceptable hints.
- One child never changes its assigned PR dynamically.
- The controller must authorize PR Steward to read final GitHub state before its
  readiness or completion verdict.
- PR Steward returns that direct observation to the controller for reconciliation.

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
- After successful exit, send one compact handoff to the controller and end the child.
  The controller acts on the result and starts a fresh child for another iteration.
- The controller authorizes PR Steward to collect final direct GitHub evidence.
  PR Steward returns the evidence to the controller for reconciliation.
- The controller retains readiness and merge authority.
- Use a harness wait that wakes on output when available. Otherwise use the
  longest host-bounded PTY read. Empty reads produce no messages or GitHub queries.


## Completion evidence

Return the operation, controller, source SHA, observed result, and relevant run
or PR identifiers. Promotion completion includes remote main equality and
actual GitHub PR state. The controller retains the delivery verdict.
