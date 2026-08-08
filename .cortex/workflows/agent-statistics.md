# AI Agent PR Statistics

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

Keep judgment in this doc.

Run assemble / validate / publish through Loom YAML requests.

Scratch JSON must include `started_at`, `change_surface`, `local_executions`,
`pr_retriggers`, `merge_attempts`, `comparison`, and `waste_assessment`.

Assemble request:

```yaml
name: agent-stats
arguments:
  action: assemble
  pr: 123
  scratch: /tmp/pr-123-events.json
  out: /tmp/123.yaml
  inventory: true
```

```bash
task loom:agent-stats CONFIG=/tmp/assemble-request.yaml
```

Validate / publish requests use `action: validate` or `action: publish` with
`file: /tmp/123.yaml`.

Examples:
[`agentic-ai/loom/params/agent-stats/`](../../agentic-ai/loom/params/agent-stats/).

Protocol: [loom-tools.md](../references/loom-tools.md).

Loom fills PR metadata, Actions runs, optional test inventory, and summary
derivations.

The agent still owns comparison quality and waste assessment text in the scratch
log before assemble.

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

`summary` values must be derivable from the detailed lists.

`test_inventory.total` must equal the sum of `by_type`.

`test_inventory.head_sha` must match `source_pr.head_sha`.

Historical schema versions `1` and `2` remain valid baselines.

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
