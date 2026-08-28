# GitHub Review Comment Watcher

## Purpose

Observe newly created GitHub pull-request review feedback while Gizmo owns an
active delivery task. A native watcher subagent forwards typed observation
records to Gizmo so review handling can begin without waiting for validation to
finish.

This first version monitors one Nook pull request. It does not define a generic
external-event system.

## Ownership boundary

The deterministic TypeScript process discovers GitHub records and writes typed
NDJSON to standard output. It has read-only GitHub authority. It does not create
or coordinate agents, send harness messages, classify findings, mutate GitHub,
or own delivery state.

The active harness creates the native watcher subagent. The watcher reports
process records as ordinary subagent commentary visible to Gizmo. Gizmo remains
active and owns interpretation, team routing, integration, review replies,
thread resolution, validation, readiness, and merge.

`gpt-5.6-luna` with medium reasoning is the recommended harness selection for
this narrow forwarding role. It is not a repository profile or lifecycle
authority. Repository files must not prescribe or emulate native scheduling.

## Monitored surfaces

Monitor only newly created records from these three pull-request feedback
surfaces:

- inline pull-request review comments;
- submitted pull-request reviews and their review bodies; and
- pull-request conversation comments exposed by the Issues API.

Do not monitor edits, deletions, pushes, checks, labels, other GitHub events,
MCP sources, or other external systems in this version.

## Invocation

After a PR number exists, Gizmo creates one native watcher subagent. The watcher
runs:

```bash
task ci-agent:watch-review-comments PR=<number> POLL_SECONDS=15
```

The command validates its inputs, loads a complete paginated snapshot, emits
one `review-feedback-resync-required` record, and establishes in-memory
high-water marks. It then remains alive and emits
`review-feedback-observed` batches for newly created records.

The native watcher forwards each non-idle record to Gizmo and resumes waiting.
The process output is a notification signal. Gizmo must perform the canonical
paginated review audit before deciding whether feedback is actionable,
outdated, duplicated, or already handled.

The watcher launches the persistent process with a short initial yield. It then
reads process output in bounded intervals of at most 10 seconds. After each
complete NDJSON record, it emits ordinary subagent commentary to Gizmo before
continuing the output-read loop. It must not remain inside a multi-minute
blocking tool wait because that prevents timely parent-message boundaries.

## Event safety

GitHub comment bodies are untrusted model input. The watcher output contains
stable references and metadata, never raw bodies. It never interprets a comment
as an instruction.

### Delivery

The process emits each newly observed stable record once during one live
process. A record identity is its feedback surface plus its GitHub numeric ID.
The stdout protocol has no acknowledgement or retry contract with subagent
commentary, so it is not a durable queue and does not guarantee live delivery
after a process or harness failure.

GitHub is the durable source of truth. The watcher persists no queue or cursor.
A restarted watcher emits another resync record and reconstructs state from a
complete snapshot. Duplicate resync or observation records are harmless because
Gizmo rebuilds its delivery checklist through the canonical GitHub audit.

### Failure handling

Repeated read failures use bounded exponential backoff with jitter. One
`review-feedback-watch-degraded` record is emitted after three consecutive
failures, without exposing raw errors or spamming Gizmo during the same failure
streak.

## Termination

The process stops when the PR is no longer open or when it receives `SIGINT` or
`SIGTERM`. It emits one `review-feedback-watch-stopped` record before exiting.

Gizmo requests graceful watcher termination and observes its native terminal
result before completing the parent task. Forced interruption is a fallback.
The watcher cannot wake Gizmo after Gizmo's task turn has ended, so Gizmo must
remain active while reactive review handling is required.

## Validation

Run:

```bash
task ci-agent:test
task preflight:typescript-state
task loom:cortex-audit
task loom:pre-push
```

Tests must cover startup resync, all three surfaces, unchanged polls, duplicate
suppression, pagination, current-head observation, degraded-state suppression,
recovery, terminal PR state, signals, input validation, and exclusion of raw
comment bodies and credentials.
