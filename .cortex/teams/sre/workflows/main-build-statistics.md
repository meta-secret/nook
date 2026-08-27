# Main Build Statistics

## Overview

The full `Main` workflow is measured independently from per-PR agent delivery
statistics. The trusted
[`main-build-stats.yml`](../../../../.github/workflows/main-build-stats.yml) workflow
runs after every completed Main attempt and stores one immutable record in
[`meta-secret/nook-workbench`](https://github.com/meta-secret/nook-workbench):

```text
stats/main-build/<run-id>-attempt-<run-attempt>.yaml
```

This includes successful, failed, and cancelled attempts. Failures and
superseded runs are retained because their partial job and step timings expose
cache misses, slow failure feedback, and avoidable cancellation waste.

## Why collection happens after Main

An `if: always()` step inside `main.yml` cannot observe its own final job or
workflow completion time. `workflow_run: completed` receives stable GitHub API
job and step timestamps after the full attempt has ended, including failure and
cancellation conclusions.

The collector checks out the default branch, never the measured run's source,
before executing repository code. It accepts only a same-repository `push` run
named `Main` on `main`, so its write token cannot execute untrusted pull-request
code.

## Recorded metrics

Each schema-version-3 record is JSON-compatible YAML and contains the fields
below. Historical schema-version-1 timing-only and schema-version-2 nullable
records remain valid baselines after boundary normalization.

- Main run ID, attempt, head SHA, conclusion, URL, and timestamps;
- associated pull requests when GitHub can resolve them;
- queue, execution, and end-to-end wall time;
- parallel Rust ecosystem job and step results from the Main run;
- aggregate producer build/verify step duration (native Rust, WASM, and browser-free web; legacy single-job step names remain recognized);
- aggregate development-deployment and coverage-export durations;
- every job and step with status, conclusion, timestamps, and duration;
- runner labels and identity for distinguishing hosted-capacity changes.
- a cache-telemetry artifact from the Main job, including the selected
  persistent/fallback sccache backend, compiler hit rate, and BuildKit
  target-record step cache rate;
- comparison with the two latest successful attempts from the same workflow,
  including threshold-based wall, execution, and build regression flags.

Incomplete steps omit `duration_seconds`. The collector never invents a
duration for a cancelled step whose completion timestamp is absent. Optional
timestamps and rates are likewise omitted when the source cannot provide a
truthful measurement. All strings are JSON-quoted, preventing colons,
timestamps, or PR titles from producing invalid YAML.

## Publication and isolation

The collector checks out Workbench, commits exactly its generated record, rebases
on the latest Workbench `main`, and pushes it directly with the trusted
`NOOK_GITHUB_PAT`. The workflow fails explicitly if the token is unavailable.
Rerunning the collector is idempotent: a valid record already present in
Workbench is accepted without another commit, while a GitHub rerun attempt
receives a distinct filename.

There is no recursive build loop or Nook PR noise:

1. a product merge triggers `Main`;
2. completed `Main` triggers `Main build statistics`;
3. the collector commits one `stats/main-build/**` file in Workbench;
4. no Nook ref changes;
5. therefore no Nook Main run, PR, or subsequent collector event is created.

The generated Workbench commit is not an AI-agent implementation PR and does not
create `stats/ai-agent/**` bookkeeping.

## Analysis

Compare `summary.execution_seconds` and `summary.build_seconds` across
successful attempts on comparable heads. Use failed and cancelled records to
diagnose wasted feedback cycles, but do not mix their partial durations into a
successful-build median. A performance regression still requires both more
than 20 percent and at least 60 seconds of slowdown against a comparable
baseline; inspect the detailed steps before assigning the cause to the build.
