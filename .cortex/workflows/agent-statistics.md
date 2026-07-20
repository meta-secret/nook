# AI Agent PR Statistics

Every task-owning AI agent must measure the work required to land each normal
pull request. The record is repository evidence for finding slow builds,
avoidable validation loops, and waste in the agent workflow; it is not a
free-form task diary.

## Lifecycle

1. Start an out-of-tree scratch record when work on a PR-bound task begins.
   Do not add a partial statistics file to the implementation PR.
2. Append every local check/test execution, applicable GitHub Actions run, PR
   retrigger, and merge attempt as it happens. Record failed and cancelled work,
   not only successful work.
3. Squash-merge the implementation PR through the normal readiness workflow.
4. Create `.stats/ai-agent/<pr-number>.yaml` from current `main` after the
   implementation PR is merged. Do this immediately; do not wait for the
   post-merge Main workflow or deployment.
5. Compare the completed record with the one or two most recent comparable
   non-stats PR records. Record the comparison and a waste assessment in the
   YAML. When fewer records exist, compare all available records and state that
   the baseline is incomplete.
6. Publish only that YAML file in a new stats-only PR and squash-merge it
   immediately using the exception below.
7. If the analysis finds an actionable regression or waste, open a separate
   normal build-performance PR and own it through validation and squash merge.
   Never mix build or workflow changes into the stats-only PR.

Stats-only PRs do not produce another statistics record. This terminates the
workflow instead of creating stats about stats.

## What to measure

Use UTC timestamps and integer durations in seconds. Measure wall-clock time,
including time spent waiting for CI or review when the agent owns that wait.

- **Local executions:** every command that checks, tests, lints, formats,
  builds, deploys, or validates. Store the exact command, category, start and
  finish timestamps, duration, outcome, and reason. A command that performs
  both checks and tests is one execution with category `combined`; do not
  double-count it.
- **GitHub Actions:** every repository-owned workflow run applicable to the PR,
  including run id, run attempt, head SHA, trigger, timestamps, duration, and
  conclusion. The post-merge Main run is outside the implementation PR lifecycle
  and must not be awaited or included merely because the merge triggered it.
- **PR retriggers:** count every new repository-owned validation cycle after
  the first. Distinguish `head_push`, `manual_rerun`, `base_update`, and
  `reopen`. A GitHub `run_attempt` greater than one is a manual rerun; a new run
  id caused by a pushed head is a head-push retrigger.
- **Merge attempts:** count every executed merge command/API call, including
  blocked or failed attempts. A readiness query is not a merge attempt.
- **PR elapsed time:** from the first agent investigation/implementation action
  for the assignment through the implementation PR's `mergedAt`. Also record
  PR-open-to-merge time separately.

The implementation PR's `mergedAt` is the terminal measurement boundary. Only
record later deployment or live-verification work when the user explicitly made
that work part of the assignment; do not extend ordinary task ownership to Main.

Never record secrets, credentials, environment values, vault data, raw logs, or
prompt/chat contents. Commands must be redacted if an argument contains secret
material.

## YAML contract

Files must be valid YAML, use schema version `1`, and follow this shape. Empty
lists are explicit; required fields must not be omitted.

```yaml
schema_version: 1
source_pr:
  number: 481
  url: https://github.com/meta-secret/nook/pull/481
  title: Example change
  change_surface: docs_ci
  head_sha: 0123456789abcdef0123456789abcdef01234567
  started_at: 2026-07-18T18:10:00Z
  opened_at: 2026-07-18T18:25:00Z
  merged_at: 2026-07-18T18:55:00Z
  elapsed_seconds: 2700
  open_to_merge_seconds: 1800
summary:
  local_execution_count: 1
  local_check_count: 0
  local_test_count: 0
  local_combined_count: 1
  local_execution_seconds: 600
  github_actions_run_count: 1
  github_actions_seconds: 1200
  pr_retrigger_count: 0
  agent_requested_rerun_count: 0
  merge_attempt_count: 1
local_executions:
  - command: task check
    category: combined
    started_at: 2026-07-18T18:26:00Z
    finished_at: 2026-07-18T18:36:00Z
    duration_seconds: 600
    outcome: passed
    reason: final_validation
github_actions_runs:
  - workflow: PR
    run_id: 123456789
    run_attempt: 1
    head_sha: 0123456789abcdef0123456789abcdef01234567
    trigger: pull_request
    started_at: 2026-07-18T18:25:30Z
    finished_at: 2026-07-18T18:45:30Z
    duration_seconds: 1200
    conclusion: success
pr_retriggers: []
merge_attempts:
  - at: 2026-07-18T18:55:00Z
    method: squash
    outcome: success
    reason: readiness_passed
comparison:
  baseline_prs: [479, 480]
  baseline_quality: comparable
  baseline_note: Similar docs and CI path-filter changes
  elapsed_seconds_change_percent: 8.2
  local_execution_seconds_change_percent: -4.0
  github_actions_seconds_change_percent: 13.5
  regression: false
  regression_reasons: []
waste_assessment:
  wasteful: false
  findings: []
  required_actions: []
```

`summary` values must be derivable from the detailed lists. Parallel local and
remote durations may overlap, so never add them together and call the result PR
elapsed time. Percent changes compare the current value with the median of the
selected baseline records; use `null` only for comparison values that cannot be
computed from available history.

## Comparison and required action

Choose the newest one or two records with a similar change surface and gate set
(for example docs-only, Rust/domain, web, browser-flow, extension, or CI/build).
Do not use stats-only PRs as baselines. Record `baseline_quality: weak` and the
reason in `baseline_note` when no genuinely comparable record exists.

Treat a metric as a performance regression when it is both:

- more than 20 percent slower than the baseline median; and
- at least 60 seconds slower in absolute time.

The threshold is a triage floor, not permission to ignore obvious waste below
it. The assessment must also inspect:

- repeated full suites where a focused test would have isolated the failure;
- local and remote final checks run serially rather than in parallel;
- reruns made without a code/configuration change or a documented flaky failure;
- avoidable merge attempts before readiness or base freshness;
- cache misses, duplicated builds, repeated dependency setup, and slow steps
  that dominate otherwise comparable runs.

If a regression or waste is actionable, `waste_assessment.required_actions`
must name the concrete build/workflow change and the agent must open a separate
normal PR that implements, validates, and lands it. An unavoidable scope
increase or external outage may be marked non-actionable only with specific
evidence in `findings`; do not use a vague “this PR was larger” rationale.

## Stats-only PR exception

A stats-only PR is valid only when its diff contains exactly one file matching
`.stats/ai-agent/<source-pr-number>.yaml`, and that source PR is already merged.
For such a PR:

- do not run local product checks or tests;
- do not request Codex or external review;
- do not wait for repository-owned checks or deployments;
- verify the YAML parses, the filename matches `source_pr.number`, the summary
  matches the detailed events, and the comparison/waste assessment is complete;
- squash-merge immediately, using the repository's authorized ruleset/admin
  bypass when GitHub expects a normally required check.

An invalid stats-only diff (for example multiple records or a filename/source PR
mismatch) must be corrected to the exact one-file shape before merge; it is
never eligible for a bypass merely because `.stats/**` skips product checks.
Build, workflow, or product changes belong in a separate normal PR and cause the
normal pipeline to run. The squash-merge rule still has no exception.

The PR and main product pipelines ignore `.stats/**`, so publishing the record
does not create an empty required validation cycle and merging it does not run
the full main pipeline.
