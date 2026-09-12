import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { MainBuildStatsCodec } from "./main-build-stats-codecs.mjs";
import { MainBuildStats } from "./main-build-stats.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));

class MainBuildStatsFixture {
  /** @returns {Parameters<typeof MainBuildStats.build>[0]} */
  static create() {
    return {
      run: {
        name: "CI",
        workflow_id: 77,
        id: 123456,
        run_attempt: 1,
        html_url: "https://github.com/meta-secret/nook/actions/runs/123456",
        event: "push",
        head_branch: "main",
        head_sha: "0123456789abcdef0123456789abcdef01234567",
        conclusion: "success",
        created_at: "2026-07-22T10:00:00Z",
        run_started_at: "2026-07-22T10:02:00Z",
        updated_at: "2026-07-22T10:21:00Z",
      },
      jobs: [
        {
          id: 9001,
          name: "Check, build, e2e, and deploy dev",
          status: "completed",
          conclusion: "success",
          runner_name: "GitHub Actions 1",
          runner_group_name: "GitHub Actions",
          labels: ["ubuntu-latest"],
          started_at: "2026-07-22T10:02:00Z",
          completed_at: "2026-07-22T10:20:00Z",
          steps: [
            {
              number: 1,
              name: "Checkout",
              status: "completed",
              conclusion: "success",
              started_at: "2026-07-22T10:02:00Z",
              completed_at: "2026-07-22T10:03:00Z",
            },
            {
              number: 2,
              name: "Preflight, check, build, and e2e",
              status: "completed",
              conclusion: "success",
              started_at: "2026-07-22T10:03:00Z",
              completed_at: "2026-07-22T10:13:00Z",
            },
            {
              number: 3,
              name: "Deploy isolated development applications to Cloudflare Pages",
              status: "completed",
              conclusion: "success",
              started_at: "2026-07-22T10:13:00Z",
              completed_at: "2026-07-22T10:15:00Z",
            },
            {
              number: 4,
              name: "Export commit-keyed nook-core/auth coverage",
              status: "completed",
              conclusion: "success",
              started_at: "2026-07-22T10:15:00Z",
              completed_at: "2026-07-22T10:15:30Z",
            },
          ],
        },
      ],
      sourcePullRequests: [
        {
          number: 700,
          html_url: "https://github.com/meta-secret/nook/pull/700",
          title: "CI: keep strings quoted\nwith context",
        },
      ],
      recordedAt: "2026-07-22T10:21:30Z",
    };
  }

  /** @param {Parameters<typeof MainBuildStats.build>[0]} input @param {number} hours */
  static shiftHours(input, hours) {
    const shifted = structuredClone(input);
    /** @param {string} value */
    const shift = (value) =>
      new Date(Date.parse(value) + hours * 60 * 60 * 1000).toISOString();
    shifted.run.created_at = shift(shifted.run.created_at);
    shifted.run.run_started_at = shift(
      this.requiredTimestamp(shifted.run.run_started_at),
    );
    shifted.run.updated_at = shift(shifted.run.updated_at);
    for (const job of shifted.jobs) {
      job.started_at = shift(this.requiredTimestamp(job.started_at));
      job.completed_at = shift(this.requiredTimestamp(job.completed_at));
      for (const step of job.steps || []) {
        step.started_at = shift(this.requiredTimestamp(step.started_at));
        step.completed_at = shift(this.requiredTimestamp(step.completed_at));
      }
    }
    shifted.recordedAt = shift(shifted.recordedAt);
    return shifted;
  }

  /** @param {string | undefined} value @returns {string} */
  static requiredTimestamp(value) {
    assert.ok(value);
    return value;
  }

  /** @template Value @param {Value[]} values @returns {Value} */
  static first(values) {
    return this.at(values, 0);
  }

  /** @template Value @param {Value[]} values @param {number} index @returns {Value} */
  static at(values, index) {
    const value = values[index];
    assert.ok(value);
    return value;
  }

  /** @param {ReturnType<typeof MainBuildStats.build>} record */
  static cacheTelemetry(record) {
    const telemetry = record.cache_telemetry;
    assert.ok(telemetry);
    return telemetry;
  }
}

void test("builds stable Main timing metrics from completed run jobs and steps", () => {
  const record = MainBuildStats.build(MainBuildStatsFixture.create());

  assert.deepEqual(record.summary, {
    queue_seconds: 120,
    execution_seconds: 1080,
    wall_seconds: 1200,
    job_count: 1,
    step_count: 4,
    // Legacy fixture still uses the pre-split Main build step name.
    build_seconds: 600,
    deployment_seconds: 120,
    coverage_seconds: 30,
  });
  assert.equal(record.source_run.completed_at, "2026-07-22T10:20:00Z");
  assert.equal(MainBuildStatsFixture.first(record.jobs).duration_seconds, 1080);
  assert.equal(
    MainBuildStatsFixture.first(record.source_pull_requests).title,
    "CI: keep strings quoted\nwith context",
  );
});

void test("serializes JSON-compatible YAML without unsafe plain scalars", () => {
  const serialized = MainBuildStats.serialize(
    MainBuildStats.build(MainBuildStatsFixture.create()),
  );
  const parsed = MainBuildStats.normalizeLegacy(
    MainBuildStatsCodec.parseJson(serialized),
  );

  assert.equal(parsed.source_run.run_id, 123456);
  assert.match(serialized, /"title": "CI: keep strings quoted\\nwith context"/);
  assert.ok(serialized.endsWith("\n"));
});

void test("records persistent compiler and BuildKit cache telemetry from Main artifacts", () => {
  const input = MainBuildStatsFixture.create();
  input.cacheTelemetry = [
    {
      schema_version: 1,
      github: {
        run_id: String(input.run.id),
        run_attempt: input.run.run_attempt,
        job: "ci",
      },
      cache_backend: {
        kind: "remote",
        persistent: true,
        reason: "persistent_service",
      },
      sccache: {
        report_count: 3,
        compile_requests: 100,
        requests_executed: 90,
        cache_hits: 72,
        cache_misses: 18,
        cache_errors: 0,
        cache_writes: 18,
        hit_rate_percent: 80,
      },
      buildkit: {
        build_record_count: 4,
        completed_steps: 50,
        cached_steps: 35,
        cache_hit_rate_percent: 70,
        measurement: "buildx_target_record_steps",
      },
      collection: { complete: true, warnings: [] },
    },
  ];

  const record = MainBuildStats.build(input);

  assert.equal(record.schema_version, 3);
  assert.equal(
    MainBuildStatsFixture.first(record.cache_telemetry.jobs).cache_backend.kind,
    "remote",
  );
  assert.equal(record.cache_telemetry.totals.sccache_hit_rate_percent, 80);
  assert.equal(
    record.cache_telemetry.totals.buildkit_cache_hit_rate_percent,
    70,
  );
  assert.equal(record.cache_telemetry.collection.complete, true);
});

void test("marks cache telemetry unavailable instead of inventing hit rates", () => {
  const record = MainBuildStats.build(MainBuildStatsFixture.create());

  assert.equal(record.cache_telemetry.totals.job_count, 0);
  assert.equal(
    Object.hasOwn(record.cache_telemetry.totals, "sccache_hit_rate_percent"),
    false,
  );
  assert.equal(
    Object.hasOwn(
      record.cache_telemetry.totals,
      "buildkit_cache_hit_rate_percent",
    ),
    false,
  );
  assert.deepEqual(record.cache_telemetry.collection.warnings, [
    "cache_telemetry_artifact_unavailable",
  ]);
});

void test("normalizes legacy schema-2 direct-compile telemetry", () => {
  const record = MainBuildStats.build(MainBuildStatsFixture.create());
  record.schema_version = 2;
  const directCompileJobs =
    record.cache_telemetry.totals.direct_compile_job_count;
  assert.ok(typeof directCompileJobs === "number");
  record.cache_telemetry.totals.local_fallback_job_count = directCompileJobs;
  delete record.cache_telemetry.totals.direct_compile_job_count;
  record.cache_telemetry.jobs = [
    {
      job: "ci",
      cache_backend: {
        kind: "local_fallback",
        persistent: false,
        reason: "credentials_unavailable",
      },
      sccache: {
        report_count: 0,
        compile_requests: 0,
        requests_executed: 0,
        cache_hits: 0,
        cache_misses: 0,
        cache_errors: 0,
        cache_writes: 0,
      },
      buildkit: {
        build_record_count: 0,
        completed_steps: 0,
        cached_steps: 0,
        measurement: "buildx_target_record_steps",
      },
      collection: { complete: true, warnings: [] },
    },
  ];
  record.cache_telemetry.totals.job_count = 1;
  record.cache_telemetry.totals.local_fallback_job_count = 1;

  const normalized = MainBuildStats.normalizeLegacy(record);

  assert.equal(normalized.cache_telemetry.totals.direct_compile_job_count, 1);
  assert.equal(
    Object.hasOwn(
      normalized.cache_telemetry.totals,
      "local_fallback_job_count",
    ),
    false,
  );
  assert.equal(
    MainBuildStatsFixture.first(normalized.cache_telemetry.jobs).cache_backend
      .kind,
    "direct_compile",
  );
  MainBuildStats.validate(normalized);
});

void test("retains incomplete failed steps without inventing duration", () => {
  const input = MainBuildStatsFixture.create();
  input.run.conclusion = "cancelled";
  MainBuildStatsFixture.first(input.jobs).conclusion = "cancelled";
  MainBuildStatsFixture.at(
    MainBuildStatsFixture.first(input.jobs).steps || [],
    1,
  ).conclusion = "cancelled";
  delete MainBuildStatsFixture.at(
    MainBuildStatsFixture.first(input.jobs).steps || [],
    1,
  ).completed_at;

  const record = MainBuildStats.build(input);

  assert.equal(record.source_run.conclusion, "cancelled");
  assert.equal(
    Object.hasOwn(
      MainBuildStatsFixture.at(
        MainBuildStatsFixture.first(record.jobs).steps || [],
        1,
      ),
      "duration_seconds",
    ),
    false,
  );
  assert.equal(Object.hasOwn(record.summary, "build_seconds"), false);
  assert.equal(record.comparison.baseline_quality, "not_applicable");
});

void test("records a cancelled attempt without jobs as queue-only time", () => {
  const input = MainBuildStatsFixture.create();
  input.run.id = 33964298285;
  input.run.conclusion = "cancelled";
  input.run.created_at = "2026-09-05T11:48:07Z";
  input.run.run_started_at = "2026-09-05T11:48:07Z";
  input.run.updated_at = "2026-09-05T12:05:14Z";
  input.jobs = [];

  const record = MainBuildStats.build(input);

  assert.equal(record.source_run.started_at, "2026-09-05T12:05:14Z");
  assert.equal(record.source_run.completed_at, "2026-09-05T12:05:14Z");
  assert.equal(record.summary.queue_seconds, 1027);
  assert.equal(record.summary.execution_seconds, 0);
  assert.equal(record.summary.wall_seconds, 1027);
  assert.equal(record.summary.job_count, 0);
  assert.equal(record.summary.step_count, 0);
  assert.deepEqual(record.jobs, []);
  assert.equal(record.comparison.baseline_quality, "not_applicable");
});

void test("rejects a non-cancelled attempt without executed jobs", () => {
  const input = MainBuildStatsFixture.create();
  input.jobs = [];

  assert.throws(
    () => MainBuildStats.build(input),
    /Main attempt 1 has no executed jobs/,
  );
});

void test("normalizes one-second GitHub timestamp skew for skipped jobs", () => {
  const input = MainBuildStatsFixture.create();
  input.jobs = [
    {
      ...MainBuildStatsFixture.first(input.jobs),
      id: 9002,
      name: "Publish GHA BuildKit cache",
      conclusion: "skipped",
      started_at: "2026-07-26T00:23:10Z",
      completed_at: "2026-07-26T00:23:09Z",
      steps: [],
    },
  ];

  const record = MainBuildStats.build(input);

  assert.equal(MainBuildStatsFixture.first(record.jobs).duration_seconds, 0);
});

void test("rejects impossible timestamps for executed jobs", () => {
  const input = MainBuildStatsFixture.create();
  MainBuildStatsFixture.first(input.jobs).started_at = "2026-07-26T00:23:10Z";
  MainBuildStatsFixture.first(input.jobs).completed_at = "2026-07-26T00:23:09Z";

  assert.throws(
    () => MainBuildStats.build(input),
    /completion precedes its start/,
  );
});

void test("excludes jobs reused from earlier attempts from rerun timing", () => {
  const input = MainBuildStatsFixture.create();
  input.run.run_attempt = 2;
  input.run.created_at = "2026-07-22T11:00:01Z";
  input.run.run_started_at = "2026-07-22T11:00:00Z";
  input.run.updated_at = "2026-07-22T11:10:00Z";
  input.jobs.push({
    ...structuredClone(MainBuildStatsFixture.first(input.jobs)),
    id: 9002,
    name: "Web e2e",
    started_at: "2026-07-22T11:00:04Z",
    completed_at: "2026-07-22T11:10:00Z",
    steps: [],
  });

  const record = MainBuildStats.build(input);

  assert.equal(record.source_run.started_at, "2026-07-22T11:00:04Z");
  assert.equal(record.summary.queue_seconds, 4);
  assert.equal(record.summary.execution_seconds, 596);
  assert.equal(record.summary.wall_seconds, 600);
  assert.equal(record.summary.job_count, 1);
  assert.equal(MainBuildStatsFixture.first(record.jobs).name, "Web e2e");
});

void test("flags successful build regressions against the two latest successful attempts", () => {
  const firstInput = MainBuildStatsFixture.shiftHours(
    MainBuildStatsFixture.create(),
    -2,
  );
  firstInput.run.id = 100001;
  const first = MainBuildStats.build(firstInput);
  const secondInput = MainBuildStatsFixture.shiftHours(
    MainBuildStatsFixture.create(),
    -1,
  );
  secondInput.run.id = 100002;
  const second = MainBuildStats.build(secondInput);
  const currentInput = MainBuildStatsFixture.create();
  currentInput.run.id = 100003;
  MainBuildStatsFixture.first(currentInput.jobs).completed_at =
    "2026-07-22T10:26:00Z";
  MainBuildStatsFixture.at(
    MainBuildStatsFixture.first(currentInput.jobs).steps || [],
    1,
  ).completed_at = "2026-07-22T10:17:00Z";
  MainBuildStatsFixture.at(
    MainBuildStatsFixture.first(currentInput.jobs).steps || [],
    2,
  ).started_at = "2026-07-22T10:17:00Z";
  MainBuildStatsFixture.at(
    MainBuildStatsFixture.first(currentInput.jobs).steps || [],
    2,
  ).completed_at = "2026-07-22T10:19:00Z";

  const current = MainBuildStats.build({
    ...currentInput,
    baselineRecords: [first, second],
  });

  assert.equal(current.comparison.baseline_quality, "comparable");
  assert.equal(current.comparison.regression, true);
  assert.deepEqual(current.comparison.baseline_runs, [
    { run_id: 100002, run_attempt: 1 },
    { run_id: 100001, run_attempt: 1 },
  ]);
  const executionChange = current.comparison.execution_seconds_change_percent;
  const buildChange = current.comparison.build_seconds_change_percent;
  assert.ok(typeof executionChange === "number");
  assert.ok(typeof buildChange === "number");
  assert.ok(executionChange > 20);
  assert.ok(buildChange > 20);
});

void test("does not use delayed collector records from the future as baselines", () => {
  const earlierInput = MainBuildStatsFixture.shiftHours(
    MainBuildStatsFixture.create(),
    -1,
  );
  earlierInput.run.id = 100001;
  const earlier = MainBuildStats.build(earlierInput);
  const futureInput = MainBuildStatsFixture.shiftHours(
    MainBuildStatsFixture.create(),
    1,
  );
  futureInput.run.id = 100003;
  const future = MainBuildStats.build(futureInput);
  const currentInput = MainBuildStatsFixture.create();
  currentInput.run.id = 100002;

  const current = MainBuildStats.build({
    ...currentInput,
    baselineRecords: [future, earlier],
  });

  assert.deepEqual(current.comparison.baseline_runs, [
    { run_id: 100001, run_attempt: 1 },
  ]);
  assert.equal(current.comparison.baseline_quality, "weak");
});

void test("rejects records whose summary cannot be derived from detailed jobs", () => {
  const record = MainBuildStats.build(MainBuildStatsFixture.create());
  record.summary.step_count += 1;

  assert.throws(
    () => MainBuildStats.validate(record),
    /summary\.step_count mismatch/,
  );
});

void test("workflow records completed trusted Main runs in Nook Workbench", () => {
  const root = path.join(directory, "..", "..", "..");
  const collector = fs.readFileSync(
    path.join(root, ".github/workflows/main-build-stats.yml"),
    "utf8",
  );
  assert.match(
    collector,
    /workflow_run:\n\s+workflows: \[CI\]\n\s+types: \[completed\]\n\s+branches: \[main\]/,
  );
  assert.match(collector, /github\.event\.workflow_run\.event == 'push'/);
  assert.match(collector, /github\.event\.workflow_run\.head_branch == 'main'/);
  assert.match(
    collector,
    /const \{ MainBuildStats \} = require\('\.\/\.github\/workflows\/lib\/main-build-stats\.mjs'\)/,
  );
  assert.doesNotMatch(collector, /await import\(|pathToFileURL/);
  assert.match(collector, /MainBuildStats\.build\(/);
  assert.doesNotMatch(collector, /main-build-stats\.cjs/);
  assert.match(
    collector,
    /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/,
  );
  assert.match(
    collector,
    /runs\/\{run_id\}\/attempts\/\{attempt_number\}'[\s\S]*attempt_number: eventRun\.run_attempt/,
  );
  assert.match(
    collector,
    /runs\/\{run_id\}\/attempts\/\{attempt_number\}\/jobs'[\s\S]*attempt_number: eventRun\.run_attempt/,
  );
  assert.match(
    collector,
    /cache-telemetry-\$\{\{ github\.event\.workflow_run\.id \}\}/,
  );
  assert.match(
    collector,
    /run-id: \$\{\{ github\.event\.workflow_run\.id \}\}/,
  );
  assert.match(collector, /github-token: \$\{\{ github\.token \}\}/);
  assert.doesNotMatch(collector, /filter: 'latest'/);
  assert.match(collector, /GH_TOKEN: \$\{\{ secrets\.NOOK_GITHUB_PAT \}\}/);
  assert.doesNotMatch(collector, /GH_TOKEN:.*github\.token/);
  assert.match(collector, /repository: meta-secret\/nook-workbench/);
  assert.match(collector, /path: workbench/);
  assert.match(
    collector,
    /NOOK_GITHUB_PAT is required to publish Main build statistics/,
  );
  assert.match(
    collector,
    /workbench\/stats\/main-build\/\$\{run\.id\}-attempt-\$\{run\.run_attempt\}\.yaml/,
  );
  assert.match(collector, /git -C workbench push origin HEAD:main/);
  assert.doesNotMatch(collector, /gh pr create|gh pr merge|\.stats\//);
});
