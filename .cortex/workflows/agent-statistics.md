# AI Agent PR Statistics

## Overview

Every task-owning AI agent must measure the work required to land each normal
pull request.

The record is repository evidence for slow builds, avoidable validation loops,
and waste in the agent workflow.

It is not a free-form task diary.

## Lifecycle

1. Start an out-of-tree scratch event log when PR-bound work begins.
2. Append every local lightweight execution, focused remote run, complete
   validation run, retrigger, and merge attempt as it happens.
3. Squash-merge the implementation PR through the normal readiness workflow.
4. Assemble `stats/ai-agent/<pr-number>.yaml` with Loom immediately after merge.
5. Compare with one or two recent comparable records.
6. Publish the YAML to Workbench `main` with Loom.
7. Open a separate build-performance PR when waste or regression is actionable.

## Mechanical entrypoint — Loom

- Keep judgment in this document.
- Run assemble, validate, and publish through Loom YAML requests.
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
- **Examples:**
  [`agentic-ai/loom/params/agent-stats/`](../../agentic-ai/loom/params/agent-stats/).
- **Protocol:** [Loom tools](../references/loom-tools.md).
- **Loom owns:** PR metadata, Actions runs, optional test inventory, and summary
  derivations.
- **The agent owns:** comparison quality and waste-assessment text in the
  scratch log before assembly.

## What to measure

Use UTC timestamps and integer durations in seconds.

Measure wall-clock time, including owned wait time.

- **Local executions:** normally `task format` / Loom pre-push and the UI demo
  contract. Heavy checks belong in GitHub Actions.
- **GitHub Actions:** every repository-owned workflow run for the PR head.
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

| `by_type` key | What to count |
|---|---|
| `rust` | Nextest cases in core domain crates |
| `preflight` | Nextest/cargo cases in `preflight` |
| `web_unit` | Vitest cases under `nook-app/nook-web` |
| `e2e` | Playwright cases under `nook-app/nook-web` |

`total` equals the sum of those four counts.

Loom `--inventory` runs the list commands when the toolchains are available.

## YAML contract

Files must be valid YAML with schema version `3`.

Required top-level keys:

- `source_pr`
- `summary`
- `test_inventory`
- `local_executions`
- `github_actions_runs`
- `cache_telemetry`
- `pr_retriggers`
- `merge_attempts`
- `comparison`
- `waste_assessment`

- `summary` values must be derivable from the detailed lists.
- `test_inventory.total` must equal the sum of `by_type`.
- `test_inventory.head_sha` must match `source_pr.head_sha`.
- Historical schema versions `1` and `2` remain valid baselines.

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

Open a separate normal PR for that change.

## Workbench publication contract

Filename must be `stats/ai-agent/<source-pr-number>.yaml`.

The source Nook PR must already be merged.

Before publishing:

- do not run local product checks or tests;
- do not create a Nook branch or PR;
- do not wait for Main or deployment;
- validate with Loom;
- publish with Loom (`task loom:agent-stats CONFIG=<publish-request.yaml>`).

Invalid records must be corrected before publication.

