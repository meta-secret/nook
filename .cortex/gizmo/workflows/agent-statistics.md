# Agent PR Statistics

## Overview

The statistics contract has explicit owners:

- **Gizmo:** Measures normal pull-request delivery. It owns the lifecycle,
  publication, and performance follow-up.
- **AI team:** Owns the Loom tooling, schema, and analysis implementation.
- **Responsible teams:** Return scoped execution evidence through implementation
  handoffs.

The record is repository evidence for slow builds, avoidable validation loops,
and waste in the agent workflow.

It is not a free-form task diary.

## Lifecycle

1. Gizmo starts an out-of-tree scratch event log when PR-bound work begins.
2. Gizmo appends every local lightweight execution, focused remote run, complete
   validation run, retrigger, and merge attempt as it happens.
3. Gizmo squash-merges the implementation PR through the readiness workflow.
4. Gizmo assembles `stats/ai-agent/<pr-number>.yaml` with Loom after merge.
5. Gizmo compares the record with one or two recent comparable records.
6. Gizmo publishes the YAML to Workbench `main` with Loom.
7. Gizmo opens a separate build-performance PR when waste or regression is
   actionable.

## Mechanical entrypoint — Loom

- Keep judgment in this document.
- Gizmo invokes assemble, validate, and publish through the dependency-free
  statistics control entrypoint after the source PR is merged.
- Scratch JSON must include:
  - `started_at`;
  - `change_surface`;
  - `local_executions`;
  - `pr_retriggers`;
  - `merge_attempts`;
  - `comparison`; and
  - `waste_assessment`;
  - `test_inventory` from hosted exact-head validation.

Assemble request:

```bash
task loom:agent-stats-control <<'JSON'
{"operation":"assemble","request":{"prNumber":123,"scratchPath":"{agentTempDir}/pr-123-scratch.json","outputPath":"{agentTempDir}/123.yaml","includeTestInventory":false}}
JSON
```

Gizmo dispatches `task remote TASK_NAME=agent-stats:inventory`. Download the
artifact with `gh run download <run-id> -n test-inventory-<head-sha> -D <dir>`,
then copy its JSON into the scratch log as `test_inventory`. No local fallback.

### Agent-local path token

- `scratchPath`, `outputPath`, and `statsFile` accept `{agentTempDir}`.
- Loom resolves the token under the operating system's temporary directory.
- The resolved directory contains the exact 40-character task-anchor commit.
- That anchor is the branch-entry commit, or the worktree's initial commit for
  a branch created with the worktree. Implementation commits do not move it.
- The first task-branch entry remains authoritative after branch re-entry.
- It also contains an opaque identifier derived from the canonical worktree.
- Separate worktrees cannot collide when they use the same commit.
- One worktree and commit resolve consistently across `assemble`, `validate`,
  and `publish`.
- Loom provisions the resolved agent directory during token resolution.
- Use the token in the control request and the corresponding task-anchored
  temporary directory when creating the scratch JSON before `assemble`.
- Ordinary absolute and relative paths remain supported.
- **Validate and publish:** invoke `task loom:agent-stats-control` with
  `{"operation":"validate","request":{"statsFile":"{agentTempDir}/123.yaml"}}`.
  To publish, use the same request with operation `publish`.
- **Transport:** pass exactly one JSON request on stdin. Unknown fields and
  operations fail closed.
- **Protocol:** [Loom tools](../../teams/ai/references/loom-tools.md).
- **AI-owned Loom tooling provides:** PR metadata, paginated Actions and Codex
  review history, per-head delivery evidence, optional test inventory, and
  summary derivations.
- **Gizmo owns:** comparison quality and waste-assessment text in the
  scratch log before assembly.

## What to measure

Use UTC timestamps and integer durations in seconds.

Measure wall-clock time, including owned wait time.

- **Local executions:** normally `task format` / Loom pre-push and the UI demo
  contract. Heavy checks belong in GitHub Actions.
- **GitHub Actions:** every repository-owned workflow run on every observed PR
  head between PR creation and merge. Expand every rerun attempt. Include queue
  time from attempt creation through completion.
  - Dispatch manual E2E with the exact current PR head SHA.
  - Retain that SHA in the workflow run title so reruns, early cancellation,
    and artifact expiry cannot change or erase source attribution.
  - Attribute a manual run only after the server-observed source-resolution
    step succeeds. Retain malformed or rejected dispatches as unattributed run
    evidence so one invalid input cannot block post-merge assembly.
  - Measure attempt one from run creation and reruns from `run_started_at`.
  - Snapshot optional runs that outlive the PR at `merged_at` with conclusion
    `nonterminal_at_merge` so post-merge assembly does not wait for them.
- **Delivery heads:** one exact commit SHA per observed PR revision, including
  the final merged implementation head. Order revisions by their first Actions
  event creation, never by a later queued or manually rerun start.
- **Review events:** Codex review request, result, finding count, and latency for
  each exact head. Count request markers only from repository owners, members,
  or collaborators. Treat Codex's thumbs-up reaction on the request as a clean
  review outcome when no submitted or clean-comment result exists.
- **Validation cycles:** each PR workflow run attempt, its exact head, duration,
  conclusion, and seconds spent running after a newer head was first observed.
- **Cancelled validation:** total duration of cancelled PR validation cycles.
- **Cache telemetry:** flatten `cache-telemetry-*` artifacts into the scratch
  log when available. Sum counters. Never average job percentages.
- **PR retriggers:** count complete validation cycles after the first.
- **Merge attempts:** count executed merge commands, including failures.
- **PR elapsed time:** first agent action through `mergedAt`.
- **Repository test inventory:** absolute case counts on the merged head.

Never record secrets, credentials, vault data, raw logs, or prompt contents.

## Test inventory counting

Measure on the merged implementation `head_sha`.

Count individual test cases, not files or suites.

- **`test_inventory.by_type`**
  - **`rust`**
    - **What to count:** Nextest cases in core domain crates
  - **`preflight`**
    - **What to count:** Nextest/cargo cases in `preflight`
  - **`web_unit`**
    - **What to count:** Vitest cases under `nook-app/nook-web`
  - **`e2e`**
    - **What to count:** Playwright cases under `nook-app/nook-web`

`total` equals the sum of those four counts.

Hosted exact-head validation owns these inventory list commands. The local
statistics control entrypoint never invokes them.

## YAML contract

Files must be valid YAML with schema version `4`.

Required top-level keys:

- `source_pr`
- `summary`
- `test_inventory`
- `local_executions`
- `github_actions_runs`
- `delivery_heads`
- `review_events`
- `validation_cycles`
- `cache_telemetry`
- `pr_retriggers`
- `merge_attempts`
- `comparison`
- `waste_assessment`

- `summary` values must be derivable from the detailed lists.
- `test_inventory.total` must equal the sum of `by_type`.
- `test_inventory.head_sha` must match `source_pr.head_sha`.
- `source_pr.head_sha` is the final PR head. `source_pr.merge_sha` is the merge
  commit. They must not be conflated after squash merge.
- Review and validation summary values must match their detailed per-head
  evidence.
- Review latency must derive from its event timestamps. Every validation cycle
  must match one exact PR Actions run attempt. Delivery heads must remain in
  strictly increasing first-observed order.
- Historical schema versions `1`, `2`, and `3` remain valid baselines.

## Comparison and required action

Choose the newest one or two records with a similar change surface.

Use `baseline_quality: weak` when no comparable record exists.

Treat a metric as a performance regression when it is both:

- more than 20 percent slower than the baseline median; and
- at least 60 seconds slower in absolute time.

Inspect repeated full suites, serial local+remote final checks, unjustified
reruns, premature merge attempts, and unexpected `direct_compile` use.

If waste is actionable, `waste_assessment.required_actions` must name the
concrete change.

Gizmo opens a separate normal PR for that change. It routes implementation to
the responsible team.

## Workbench publication contract

Publication requires:

- Gizmo owns and performs the procedure.
- The filename is `stats/ai-agent/<source-pr-number>.yaml`.
- The source Nook PR is already merged.

Before publishing:

- do not run local product checks or tests;
- do not create a Nook branch or PR;
- do not wait for Main or deployment;
- validate with Loom;
- publish with Loom through `task loom:agent-stats-control` and the `publish`
  request shown above.

Invalid records must be corrected before publication.
