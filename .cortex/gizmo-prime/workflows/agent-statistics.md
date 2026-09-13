# Agent PR Statistics

## Overview

The statistics contract has explicit owners:

- **Gizmo Prime and Feature Gizmo:** Gizmo Prime owns mission-level routing and
  delivery decisions. Feature Gizmo owns measurement judgment, exact
  Workbench record authorship, Workbench state decisions, and performance
  follow-up within its scope.
- **Delivery Pipeline Team Gizmo:** Routes authorized mechanical packets through
  the active harness and synthesizes evidence. It has no PR creation/update or
  policy authority.
- **PR Lifecycle Agent:** Executes only the packetized mechanical Loom and
  GitHub operations dispatched by Delivery Pipeline Team Gizmo through the
  active harness. It has no PR creation/update, Workbench authorship/state, or
  policy authority.
- **AI team:** Owns the Loom tooling, schema, and analysis implementation.
- **Responsible teams:** Return scoped execution evidence through implementation
  handoffs.

The record is repository evidence for slow builds, avoidable validation loops,
and waste in the agent workflow.

It is not a free-form task diary.

## Lifecycle

1. Feature Gizmo starts an out-of-tree scratch event log when PR-bound work
   begins.
2. Feature Gizmo appends every local lightweight execution, focused remote run,
   complete validation run, retrigger, and merge attempt as it happens.
3. The Dev Manager authorizes Delivery Pipeline Team Gizmo to route the guarded
   fast-forward promotion packet through the active harness to PR Lifecycle
   Agent after full slow validation and required review/security acceptance.
4. After merge, Feature Gizmo authors and approves the assemble request and
   exact Workbench record content. Gizmo Prime routes the packet through
   Delivery Pipeline Team Gizmo, which dispatches PR Lifecycle Agent through
   the active harness to mechanically assemble
   `stats/ai-agent/<pr-number>.yaml` with Loom.
5. Feature Gizmo compares the record with one or two recent comparable records.
6. Feature Gizmo decides that the YAML is approved for its Workbench state.
   Gizmo Prime routes the publication packet through Delivery Pipeline Team
   Gizmo, which dispatches PR Lifecycle Agent through the active harness to
   mechanically publish the exact approved YAML to Workbench `main` with Loom.
7. Feature Gizmo records an actionable build-performance improvement and routes
   implementation to the responsible team through the normal delivery path;
   Feature Gizmo, Delivery Pipeline Team Gizmo, and PR Lifecycle Agent do not
   create or update pull requests. The manager-only `dev:pr-manager` path
   remains the sole PR creation/update path for the manager-stage dev cycle.

## Mechanical entrypoint — Loom

- Keep judgment in this document.
- Feature Gizmo authors the Loom YAML requests, exact Workbench record content,
  and lifecycle decisions and owns their interpretation.
- Gizmo Prime routes each feature-authorized packet through Delivery Pipeline
  Team Gizmo. For manager-stage publication, validation, and promotion, the
  dev manager authorizes the Delivery Pipeline packet. Team Gizmo dispatches
  PR Lifecycle Agent through the active harness to mechanically run the
  packetized GitHub-backed operations.
- Team Gizmo and PR Lifecycle Agent must not create or update PRs, author
  Workbench content, or decide policy, readiness, promotion, or Workbench
  state.
- Local validation without GitHub access remains with the responsible owner.
- Scratch JSON must include:
  - `started_at`;
  - `change_surface`;
  - `local_executions`;
  - `pr_retriggers`;
  - `merge_attempts`;
  - `comparison`; and
  - `waste_assessment`.

Assemble request:

```yaml
agentStats:
  assemble:
    prNumber: 123
    scratchPath: "{agentTempDir}/pr-123-scratch.json"
    outputPath: "{agentTempDir}/123.yaml"
    includeTestInventory: true
```

```bash
task loom:agent-stats CONFIG=path/to/agent-owned/assemble-request.yaml
```

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
- `task loom:tools-list` returns the filled path in `resolvedExampleYaml`.
- Loom provisions the resolved agent directory during token resolution.
- Use that resolved path when creating the scratch JSON before `assemble`.
- Ordinary absolute and relative paths remain supported.
- The request file passed through `CONFIG` must also live in agent-owned
  storage. Do not reuse a shared fixed `/tmp` request filename.

- **Validate and publish:** use `agentStats.validate` or `agentStats.publish`
  with `statsFile: "{agentTempDir}/123.yaml"`.
- **Examples:** copy `exampleYaml` from `task loom:tools-list`.
- **Protocol:** [Loom tools](../../teams/ai/references/loom-tools.md).
- **AI-owned Loom tooling provides:** PR metadata, paginated Actions and Codex
  review history, per-head delivery evidence, optional test inventory, and
  summary derivations.
- **Feature Gizmo owns:** comparison quality and waste-assessment text in the
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

Loom `--inventory` runs the list commands when the toolchains are available.

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
  commit. Keep feature, local integration, and tested dev SHAs distinct.
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

Feature Gizmo records the actionable improvement and routes implementation to
the responsible team. The resulting feature branch follows the normal remote
compilation and manager-controlled dev delivery path. Feature Gizmo and Gizmo
Prime do not open or update pull requests; the manager-only `dev:pr-manager`
path owns that operation.

## Workbench publication contract

Publication requires:

- Feature Gizmo authors the exact record content and decides its Workbench
  publication state; Gizmo Prime owns the delivery handoff.
- Gizmo Prime routes the authorized packet through Delivery Pipeline Team
  Gizmo, which dispatches PR Lifecycle Agent through the active harness.
- PR Lifecycle Agent mechanically publishes only the exact controller-authored
  content to the named destination. It does not author Workbench content, decide
  Workbench state or policy, or create/update PRs.
- The filename is `stats/ai-agent/<source-pr-number>.yaml`.
- The source Nook PR is already merged.

Before publishing:

- do not run local product checks or tests;
- do not create a Nook branch or PR;
- do not wait for Main or deployment;
- validate with Loom after Delivery Pipeline Team Gizmo dispatches the packet
  to PR Lifecycle Agent through the active harness;
- publish with Loom after that routed dispatch
  (`task loom:agent-stats CONFIG=<publish-request.yaml>`).

Invalid records must be corrected before publication.
