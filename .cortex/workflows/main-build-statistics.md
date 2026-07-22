# Main Build Statistics

The full `Main` workflow is measured independently from per-PR agent delivery
statistics. The trusted
[`main-build-stats.yml`](../../.github/workflows/main-build-stats.yml) workflow
runs after every completed Main attempt and stores one immutable record at:

```text
.stats/main-build/<run-id>-attempt-<run-attempt>.yaml
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

Each schema-version-1 record is JSON-compatible YAML and contains:

- Main run ID, attempt, head SHA, conclusion, URL, and timestamps;
- associated pull requests when GitHub can resolve them;
- queue, execution, and end-to-end wall time;
- the combined `Preflight, check, build, and e2e` step duration;
- aggregate development-deployment and coverage-export durations;
- every job and step with status, conclusion, timestamps, and duration;
- runner labels and identity for distinguishing hosted-capacity changes.
- comparison with the two latest successful attempts from the same workflow,
  including threshold-based wall, execution, and build regression flags.

Incomplete steps use `null` duration. The collector never invents a duration
for a cancelled step whose completion timestamp is absent. All strings are
JSON-quoted, preventing colons, timestamps, or PR titles from producing invalid
YAML.

## Publication and loop termination

The collector creates a branch containing exactly its one generated record,
opens a stats-only PR, and squash-merges it immediately with the trusted
`NOOK_GITHUB_PAT` (falling back to `GITHUB_TOKEN` when repository rules allow).
Rerunning the collector is idempotent: a valid record already present on `main`
is accepted without another PR, while a GitHub rerun attempt receives a distinct
filename.

There is no recursive build loop:

1. a product merge triggers `Main`;
2. completed `Main` triggers `Main build statistics`;
3. the collector merges one `.stats/main-build/**` file;
4. both PR and Main workflows ignore `.stats/**`;
5. therefore the stats merge creates no Main run and no subsequent collector
   event.

The generated stats-only PR is not an AI-agent implementation PR and does not
create `.stats/ai-agent/**` bookkeeping.

## Analysis

Compare `summary.execution_seconds` and `summary.build_seconds` across
successful attempts on comparable heads. Use failed and cancelled records to
diagnose wasted feedback cycles, but do not mix their partial durations into a
successful-build median. A performance regression still requires both more
than 20 percent and at least 60 seconds of slowdown against a comparable
baseline; inspect the detailed steps before assigning the cause to the build.
