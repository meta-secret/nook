import fs from "node:fs";
import { isDeepStrictEqual } from "node:util";

import { CacheTelemetry } from "./cache-telemetry.mjs";
import { MainBuildStatsCodec } from "./main-build-stats-codecs.mjs";

// Producer compile/verify work only. Browser suites are parallel consumers and must not
// inflate build_seconds relative to the historical single-job Main step.
const BUILD_STEPS = new Set([
  "Native Rust format, tests, and coverage",
  "WASM clippy, build, and package export",
  "WASM Node tests",
  "Svelte checks, JS unit tests, lint, and web build",
  // Legacy single-job Main step names retained for historical records.
  "Preflight, check, build, and e2e",
  "Preflight, check, build, and web e2e",
  "Preflight and build images",
]);
const DEPLOYMENT_STEPS = new Set([
  "Build sealed web image for development deploy",
  "Deploy isolated development applications to Cloudflare Pages",
  "Configure and verify isolated development domains",
  "Record development deployment",
]);
const COVERAGE_STEPS = new Set([
  "Export commit-keyed nook-core/auth coverage",
  "Upload commit-keyed nook-core/auth coverage",
]);

/** @typedef {Record<string, unknown>} JsonRecord */
/** @typedef {{number: number, name: string, status: string, conclusion?: string, started_at?: string, completed_at?: string}} GithubStep */
/** @typedef {{id: number, name: string, status: string, conclusion?: string, runner_name?: string, runner_group_name?: string, labels?: unknown[], started_at?: string, completed_at?: string, steps?: GithubStep[]}} GithubJob */
/** @typedef {{name: string, workflow_id: number, id: number, run_attempt: number, html_url: string, event: string, head_branch: string, head_sha: string, conclusion: string, created_at: string, run_started_at?: string, updated_at: string}} GithubRun */
/** @typedef {{number: number, html_url: string, title: string}} GithubPullRequest */
/** @typedef {{run: GithubRun, jobs: GithubJob[], sourcePullRequests?: GithubPullRequest[], baselineRecords?: MainBuildRecord[], cacheTelemetry?: JsonRecord[], recordedAt: string}} MainBuildRequest */
/** @typedef {{kind: 'unavailable'} | {kind: 'complete', seconds: number}} DurationMeasurement */
/** @typedef {{number: number, name: string, status: string, conclusion?: string, started_at?: string, completed_at?: string, duration_seconds?: number}} MainBuildStep */
/** @typedef {{id: number, name: string, status: string, conclusion?: string, runner_name?: string, runner_group_name?: string, labels: string[], started_at?: string, completed_at?: string, duration_seconds?: number, steps: MainBuildStep[]}} MainBuildJob */
/** @typedef {{workflow_name: 'Main', workflow_id: number, run_id: number, run_attempt: number, url: string, event: 'push', head_branch: 'main', head_sha: string, conclusion: string, created_at: string, started_at: string, completed_at: string}} MainBuildSource */
/** @typedef {{queue_seconds: number, execution_seconds: number, wall_seconds: number, job_count: number, step_count: number, build_seconds?: number, deployment_seconds?: number, coverage_seconds?: number}} MainBuildSummary */
/** @typedef {{baseline_runs: {run_id: number, run_attempt: number}[], baseline_quality: string, baseline_note: string, wall_seconds_change_percent?: number, execution_seconds_change_percent?: number, build_seconds_change_percent?: number, regression: boolean, regression_reasons: string[]}} MainBuildComparison */
/** @typedef {{job: string, cache_backend: {kind: 'remote' | 'direct_compile' | 'local_fallback', persistent: boolean, reason: string}, sccache: {report_count: number, compile_requests: number, requests_executed: number, cache_hits: number, cache_misses: number, cache_errors: number, cache_writes: number, hit_rate_percent?: number}, buildkit: {build_record_count: number, completed_steps: number, cached_steps: number, cache_hit_rate_percent?: number, measurement: 'buildx_target_record_steps'}, collection: {complete: boolean, warnings: string[]}}} MainBuildCacheJob */
/** @typedef {{totals: {job_count: number, remote_backend_job_count: number, direct_compile_job_count?: number, local_fallback_job_count?: number, sccache_compile_requests: number, sccache_cache_hits: number, sccache_cache_misses: number, sccache_hit_rate_percent?: number, buildkit_completed_steps: number, buildkit_cached_steps: number, buildkit_cache_hit_rate_percent?: number}, jobs: MainBuildCacheJob[], collection: {complete: boolean, warnings: string[]}}} MainBuildCacheTelemetry */
/** @typedef {{schema_version: 1 | 2 | 3, recorded_at: string, source_run: MainBuildSource, source_pull_requests: {number: number, url: string, title: string}[], summary: MainBuildSummary, cache_telemetry: MainBuildCacheTelemetry, jobs: MainBuildJob[], comparison: MainBuildComparison}} MainBuildRecord */
/** @typedef {{runId?: number, runAttempt?: number}} MainBuildExpectation */
/** @typedef {{baseline?: number, changePercent?: number, regression: boolean}} MetricComparison */

export class MainBuildStats {
  /** @param {unknown} value @returns {value is MainBuildRecord} */
  static hasRecordStructure(value) {
    if (!MainBuildStatsCodec.isJsonRecord(value)) return false;
    return (
      MainBuildStatsCodec.isJsonRecord(value.source_run) &&
      MainBuildStatsCodec.isJsonRecord(value.summary) &&
      MainBuildStatsCodec.isJsonRecord(value.comparison) &&
      Array.isArray(value.source_pull_requests) &&
      Array.isArray(value.jobs)
    );
  }

  /** @param {unknown} value @param {string} label @returns {number} */
  static timestampMilliseconds(value, label) {
    const timestamp = Date.parse(
      MainBuildStatsCodec.requireString(value, label),
    );
    if (!Number.isFinite(timestamp))
      throw new Error(`${label} must be an ISO timestamp`);
    return timestamp;
  }

  /**
   * @param {string | undefined} startedAt
   * @param {string | undefined} completedAt
   * @param {string} label
   * @param {{negativeSkewToleranceMilliseconds?: number}} [options]
   * @returns {DurationMeasurement}
   */
  static durationSeconds(
    startedAt,
    completedAt,
    label,
    { negativeSkewToleranceMilliseconds = 0 } = {},
  ) {
    if (!startedAt || !completedAt) return { kind: "unavailable" };
    const started = this.timestampMilliseconds(
      startedAt,
      `${label}.started_at`,
    );
    const completed = this.timestampMilliseconds(
      completedAt,
      `${label}.completed_at`,
    );
    if (completed < started) {
      if (started - completed <= negativeSkewToleranceMilliseconds) {
        return { kind: "complete", seconds: 0 };
      }
      throw new Error(`${label} completion precedes its start`);
    }
    return {
      kind: "complete",
      seconds: Math.round((completed - started) / 1000),
    };
  }

  /** @param {DurationMeasurement} measurement @returns {{duration_seconds?: number}} */
  static durationField(measurement) {
    return measurement.kind === "complete"
      ? { duration_seconds: measurement.seconds }
      : {};
  }

  /** @param {(string | undefined)[]} values @param {string} fallback @returns {string} */
  static maximumTimestamp(values, fallback) {
    const timestamps = values.filter((value) => typeof value === "string");
    if (timestamps.length === 0) return fallback;
    return timestamps.reduce((latest, value) =>
      this.timestampMilliseconds(value, "completion timestamp") >
      this.timestampMilliseconds(latest, "completion timestamp")
        ? value
        : latest,
    );
  }

  /** @param {(string | undefined)[]} values @param {string} fallback @returns {string} */
  static minimumTimestamp(values, fallback) {
    const timestamps = values.filter((value) => typeof value === "string");
    if (timestamps.length === 0) return fallback;
    return timestamps.reduce((earliest, value) =>
      this.timestampMilliseconds(value, "start timestamp") <
      this.timestampMilliseconds(earliest, "start timestamp")
        ? value
        : earliest,
    );
  }

  /** @param {GithubStep} step @returns {MainBuildStep} */
  static normalizeStep(step) {
    const duration = this.durationSeconds(
      step.started_at,
      step.completed_at,
      `step ${step.name}`,
    );
    return {
      number: MainBuildStatsCodec.requireInteger(step.number, "step.number"),
      name: MainBuildStatsCodec.requireString(step.name, "step.name"),
      status: MainBuildStatsCodec.requireString(step.status, "step.status"),
      ...(step.conclusion ? { conclusion: step.conclusion } : {}),
      ...(step.started_at ? { started_at: step.started_at } : {}),
      ...(step.completed_at ? { completed_at: step.completed_at } : {}),
      ...this.durationField(duration),
    };
  }

  /** @param {GithubJob} job @returns {MainBuildJob} */
  static normalizeJob(job) {
    const { steps: rawSteps = [] } = job;
    const steps = rawSteps
      .map((step) => this.normalizeStep(step))
      .sort((left, right) => left.number - right.number);
    const duration = this.durationSeconds(
      job.started_at,
      job.completed_at,
      `job ${job.name}`,
      {
        // GitHub can report a never-started skipped job as completing one second
        // before its nominal start when both timestamps are rounded to seconds.
        negativeSkewToleranceMilliseconds:
          job.conclusion === "skipped" ? 1000 : 0,
      },
    );
    return {
      id: MainBuildStatsCodec.requireInteger(job.id, "job.id"),
      name: MainBuildStatsCodec.requireString(job.name, "job.name").replace(
        /^Main validation \/ /,
        "",
      ),
      status: MainBuildStatsCodec.requireString(job.status, "job.status"),
      ...(job.conclusion ? { conclusion: job.conclusion } : {}),
      ...(job.runner_name ? { runner_name: job.runner_name } : {}),
      ...(job.runner_group_name
        ? { runner_group_name: job.runner_group_name }
        : {}),
      labels: Array.isArray(job.labels) ? job.labels.map(String) : [],
      ...(job.started_at ? { started_at: job.started_at } : {}),
      ...(job.completed_at ? { completed_at: job.completed_at } : {}),
      ...this.durationField(duration),
      steps,
    };
  }

  /** @param {MainBuildJob[]} jobs @param {(name: string) => boolean} predicate @returns {DurationMeasurement} */
  static sumNamedStepSeconds(jobs, predicate) {
    const measured = jobs.flatMap((job) =>
      job.steps
        .filter((step) => predicate(step.name))
        .map((step) => step.duration_seconds),
    );
    const durations = measured.filter(
      (duration) => typeof duration === "number",
    );
    if (
      durations.length === 0 ||
      durations.length !== measured.length ||
      durations.some((duration) => !Number.isInteger(duration))
    ) {
      return { kind: "unavailable" };
    }
    return {
      kind: "complete",
      seconds: durations.reduce((total, duration) => total + duration, 0),
    };
  }

  /** @param {number[]} values @returns {number} */
  static median(values) {
    const sorted = [...values].sort((left, right) => left - right);
    if (sorted.length === 0) {
      throw new Error("median requires at least one measured value");
    }
    const middle = Math.floor(sorted.length / 2);
    const upper = sorted[middle];
    if (typeof upper !== "number") {
      throw new Error("median could not select its middle value");
    }
    if (sorted.length % 2 === 1) return upper;
    const lower = sorted[middle - 1];
    if (typeof lower !== "number") {
      throw new Error("median could not select its lower middle value");
    }
    return (lower + upper) / 2;
  }

  /** @param {number | undefined} current @param {(number | undefined)[]} baselines @returns {MetricComparison} */
  static metricComparison(current, baselines) {
    const measuredBaselines = baselines.filter(
      (value) => typeof value === "number",
    );
    if (
      typeof current !== "number" ||
      !Number.isFinite(current) ||
      baselines.length === 0 ||
      measuredBaselines.length !== baselines.length ||
      measuredBaselines.some((value) => !Number.isFinite(value))
    ) {
      return { regression: false };
    }
    const baseline = this.median(measuredBaselines);
    if (baseline === 0) {
      return { baseline, regression: false };
    }
    const changePercent =
      Math.round(((current - baseline) / baseline) * 1000) / 10;
    return {
      baseline,
      changePercent,
      regression: current - baseline >= 60 && changePercent > 20,
    };
  }

  /** @param {JsonRecord[]} cacheTelemetry @param {GithubRun | {id: number, run_attempt: number}} run @returns {MainBuildCacheTelemetry} */
  static cacheTelemetrySummary(cacheTelemetry, run) {
    const jobs = cacheTelemetry
      .map((candidate) =>
        MainBuildStatsCodec.admitCacheTelemetry(candidate, {
          runId: run.id,
          runAttempt: run.run_attempt,
        }),
      )
      .sort((left, right) => left.job.localeCompare(right.job));

    const sccacheRequests = jobs.reduce(
      (sum, job) => sum + job.sccache.compile_requests,
      0,
    );
    const sccacheHits = jobs.reduce(
      (sum, job) => sum + job.sccache.cache_hits,
      0,
    );
    const sccacheMisses = jobs.reduce(
      (sum, job) => sum + job.sccache.cache_misses,
      0,
    );
    const buildkitCompleted = jobs.reduce(
      (sum, job) => sum + job.buildkit.completed_steps,
      0,
    );
    const buildkitCached = jobs.reduce(
      (sum, job) => sum + job.buildkit.cached_steps,
      0,
    );
    const warnings =
      jobs.length === 0
        ? ["cache_telemetry_artifact_unavailable"]
        : jobs.flatMap((job) => job.collection.warnings);

    return {
      totals: {
        job_count: jobs.length,
        remote_backend_job_count: jobs.filter(
          (job) => job.cache_backend.kind === "remote",
        ).length,
        direct_compile_job_count: jobs.filter(
          (job) => job.cache_backend.kind === "direct_compile",
        ).length,
        sccache_compile_requests: sccacheRequests,
        sccache_cache_hits: sccacheHits,
        sccache_cache_misses: sccacheMisses,
        ...(sccacheHits + sccacheMisses === 0
          ? {}
          : {
              sccache_hit_rate_percent:
                Math.round(
                  (sccacheHits / (sccacheHits + sccacheMisses)) * 10_000,
                ) / 100,
            }),
        buildkit_completed_steps: buildkitCompleted,
        buildkit_cached_steps: buildkitCached,
        ...(buildkitCompleted === 0
          ? {}
          : {
              buildkit_cache_hit_rate_percent:
                Math.round((buildkitCached / buildkitCompleted) * 10_000) / 100,
            }),
      },
      jobs,
      collection: {
        complete:
          jobs.length > 0 && jobs.every((job) => job.collection.complete),
        warnings,
      },
    };
  }

  /** @param {Omit<MainBuildRecord, 'comparison'>} record @param {MainBuildRecord[]} baselineRecords @returns {MainBuildRecord} */
  static addComparison(record, baselineRecords) {
    if (record.source_run.conclusion !== "success") {
      return {
        ...record,
        comparison: {
          baseline_runs: [],
          baseline_quality: "not_applicable",
          baseline_note:
            "Failed and cancelled attempts retain partial timings but are not compared with successful builds",
          regression: false,
          regression_reasons: [],
        },
      };
    }

    const currentCompletedAt = this.timestampMilliseconds(
      record.source_run.completed_at,
      "source_run.completed_at",
    );
    const baselines = baselineRecords
      .filter(
        (candidate) =>
          candidate.source_run?.workflow_id === record.source_run.workflow_id &&
          candidate.source_run?.conclusion === "success" &&
          !(
            candidate.source_run?.run_id === record.source_run.run_id &&
            candidate.source_run?.run_attempt === record.source_run.run_attempt
          ) &&
          this.timestampMilliseconds(
            candidate.source_run.completed_at,
            "baseline.completed_at",
          ) < currentCompletedAt,
      )
      .sort(
        (left, right) =>
          this.timestampMilliseconds(
            right.source_run.completed_at,
            "baseline.completed_at",
          ) -
          this.timestampMilliseconds(
            left.source_run.completed_at,
            "baseline.completed_at",
          ),
      )
      .slice(0, 2);
    const wall = this.metricComparison(
      record.summary.wall_seconds,
      baselines.map((candidate) => candidate.summary.wall_seconds),
    );
    const execution = this.metricComparison(
      record.summary.execution_seconds,
      baselines.map((candidate) => candidate.summary.execution_seconds),
    );
    const build = this.metricComparison(
      record.summary.build_seconds,
      baselines.map((candidate) => candidate.summary.build_seconds),
    );
    const regressionReasons = [];
    if (wall.regression)
      regressionReasons.push("wall_seconds_exceeded_baseline_threshold");
    if (execution.regression) {
      regressionReasons.push("execution_seconds_exceeded_baseline_threshold");
    }
    if (build.regression)
      regressionReasons.push("build_seconds_exceeded_baseline_threshold");

    return {
      ...record,
      comparison: {
        baseline_runs: baselines.map((candidate) => ({
          run_id: candidate.source_run.run_id,
          run_attempt: candidate.source_run.run_attempt,
        })),
        baseline_quality: baselines.length === 2 ? "comparable" : "weak",
        baseline_note:
          baselines.length === 0
            ? "No earlier successful Main records are available"
            : baselines.length === 1
              ? "Only one earlier successful Main record is available"
              : "Two most recent successful Main attempts from the same workflow",
        ...("changePercent" in wall
          ? { wall_seconds_change_percent: wall.changePercent }
          : {}),
        ...("changePercent" in execution
          ? { execution_seconds_change_percent: execution.changePercent }
          : {}),
        ...("changePercent" in build
          ? { build_seconds_change_percent: build.changePercent }
          : {}),
        regression: regressionReasons.length > 0,
        regression_reasons: regressionReasons,
      },
    };
  }

  /** @param {MainBuildRequest} request @returns {MainBuildRecord} */
  static build({
    run,
    jobs,
    sourcePullRequests = [],
    baselineRecords = [],
    cacheTelemetry = [],
    recordedAt,
  }) {
    if (run.name !== "CI")
      throw new Error(`expected CI workflow, got ${run.name}`);
    if (run.event !== "push")
      throw new Error(`expected push event, got ${run.event}`);
    if (run.head_branch !== "main")
      throw new Error(`expected main branch, got ${run.head_branch}`);

    const attemptStartedAt = run.run_started_at || run.created_at;
    const attemptStartedMilliseconds = this.timestampMilliseconds(
      attemptStartedAt,
      "source_run.attempt_started_at",
    );
    const attemptJobs =
      run.run_attempt > 1
        ? jobs.filter((job) => {
            if (!job.started_at) return false;
            const jobStartedMilliseconds = this.timestampMilliseconds(
              job.started_at,
              `job ${job.name}.started_at`,
            );
            // GitHub's rerun-attempt endpoint also returns successful jobs reused
            // from earlier attempts. Keep only jobs that actually ran in this
            // attempt, allowing one second for API timestamp rounding.
            return jobStartedMilliseconds >= attemptStartedMilliseconds - 1000;
          })
        : jobs;
    const hasExecutedJobs = attemptJobs.length > 0;
    if (!hasExecutedJobs && run.conclusion !== "cancelled") {
      throw new Error(`Main attempt ${run.run_attempt} has no executed jobs`);
    }

    const normalizedJobs = attemptJobs
      .map((job) => this.normalizeJob(job))
      .sort((left, right) => {
        if (!left.started_at) return 1;
        if (!right.started_at) return -1;
        return (
          this.timestampMilliseconds(left.started_at, "job.started_at") -
          this.timestampMilliseconds(right.started_at, "job.started_at")
        );
      });
    const earliestJobStartedAt = this.minimumTimestamp(
      normalizedJobs.map((job) => job.started_at),
      run.run_started_at || run.created_at,
    );
    const wallStartedAt =
      run.run_attempt > 1 ? attemptStartedAt : run.created_at;
    const completedAt = this.maximumTimestamp(
      normalizedJobs.map((job) => job.completed_at),
      run.updated_at,
    );
    const startedAt = hasExecutedJobs
      ? run.run_attempt > 1
        ? earliestJobStartedAt
        : run.run_started_at || earliestJobStartedAt
      : completedAt;
    const queueSeconds = this.durationSeconds(
      wallStartedAt,
      startedAt,
      "source_run.queue",
    );
    const executionSeconds = this.durationSeconds(
      startedAt,
      completedAt,
      "source_run.execution",
    );
    const wallSeconds = this.durationSeconds(
      wallStartedAt,
      completedAt,
      "source_run.wall",
    );
    if (
      queueSeconds.kind !== "complete" ||
      executionSeconds.kind !== "complete" ||
      wallSeconds.kind !== "complete"
    ) {
      throw new Error("source run timestamps must produce complete durations");
    }
    const buildSeconds = this.sumNamedStepSeconds(normalizedJobs, (name) =>
      BUILD_STEPS.has(name),
    );
    const deploymentSeconds = this.sumNamedStepSeconds(normalizedJobs, (name) =>
      DEPLOYMENT_STEPS.has(name),
    );
    const coverageSeconds = this.sumNamedStepSeconds(normalizedJobs, (name) =>
      COVERAGE_STEPS.has(name),
    );

    const record = this.addComparison(
      {
        schema_version: 3,
        recorded_at: MainBuildStatsCodec.requireString(
          recordedAt,
          "recorded_at",
        ),
        source_run: {
          workflow_name: "Main",
          workflow_id: MainBuildStatsCodec.requireInteger(
            run.workflow_id,
            "source_run.workflow_id",
          ),
          run_id: MainBuildStatsCodec.requireInteger(
            run.id,
            "source_run.run_id",
          ),
          run_attempt: MainBuildStatsCodec.requireInteger(
            run.run_attempt,
            "source_run.run_attempt",
          ),
          url: MainBuildStatsCodec.requireString(
            run.html_url,
            "source_run.url",
          ),
          event: "push",
          head_branch: "main",
          head_sha: MainBuildStatsCodec.requireString(
            run.head_sha,
            "source_run.head_sha",
          ),
          conclusion: MainBuildStatsCodec.requireString(
            run.conclusion,
            "source_run.conclusion",
          ),
          created_at: MainBuildStatsCodec.requireString(
            run.created_at,
            "source_run.created_at",
          ),
          started_at: startedAt,
          completed_at: completedAt,
        },
        source_pull_requests: sourcePullRequests.map((pullRequest) => ({
          number: MainBuildStatsCodec.requireInteger(
            pullRequest.number,
            "source_pull_request.number",
          ),
          url: MainBuildStatsCodec.requireString(
            pullRequest.html_url,
            "source_pull_request.url",
          ),
          title: MainBuildStatsCodec.requireString(
            pullRequest.title,
            "source_pull_request.title",
          ),
        })),
        summary: {
          queue_seconds: queueSeconds.seconds,
          execution_seconds: executionSeconds.seconds,
          wall_seconds: wallSeconds.seconds,
          job_count: normalizedJobs.length,
          step_count: normalizedJobs.reduce(
            (total, job) => total + job.steps.length,
            0,
          ),
          ...(buildSeconds.kind === "complete"
            ? { build_seconds: buildSeconds.seconds }
            : {}),
          ...(deploymentSeconds.kind === "complete"
            ? { deployment_seconds: deploymentSeconds.seconds }
            : {}),
          ...(coverageSeconds.kind === "complete"
            ? { coverage_seconds: coverageSeconds.seconds }
            : {}),
        },
        cache_telemetry: this.cacheTelemetrySummary(cacheTelemetry, run),
        jobs: normalizedJobs,
      },
      baselineRecords,
    );

    this.validate(record);
    return record;
  }

  /** @param {MainBuildRecord} record @param {MainBuildExpectation} [expected] @returns {MainBuildRecord} */
  static validate(record, expected = {}) {
    if (!record || typeof record !== "object")
      throw new Error("record must be an object");
    if (![1, 2, 3].includes(record.schema_version)) {
      throw new Error("schema_version must be 1, 2, or 3");
    }
    this.timestampMilliseconds(record.recorded_at, "recorded_at");

    const source = record.source_run;
    if (!source || typeof source !== "object")
      throw new Error("source_run is required");
    if (source.workflow_name !== "Main")
      throw new Error("source_run.workflow_name must be Main");
    if (source.event !== "push")
      throw new Error("source_run.event must be push");
    if (source.head_branch !== "main")
      throw new Error("source_run.head_branch must be main");
    MainBuildStatsCodec.requireInteger(
      source.workflow_id,
      "source_run.workflow_id",
    );
    MainBuildStatsCodec.requireInteger(source.run_id, "source_run.run_id");
    MainBuildStatsCodec.requireInteger(
      source.run_attempt,
      "source_run.run_attempt",
    );
    MainBuildStatsCodec.requireString(source.url, "source_run.url");
    MainBuildStatsCodec.requireString(source.head_sha, "source_run.head_sha");
    MainBuildStatsCodec.requireString(
      source.conclusion,
      "source_run.conclusion",
    );
    this.timestampMilliseconds(source.created_at, "source_run.created_at");
    this.timestampMilliseconds(source.started_at, "source_run.started_at");
    this.timestampMilliseconds(source.completed_at, "source_run.completed_at");

    if ("runId" in expected && source.run_id !== expected.runId) {
      throw new Error(
        `source run ${source.run_id} does not match expected run ${expected.runId}`,
      );
    }
    if (
      "runAttempt" in expected &&
      source.run_attempt !== expected.runAttempt
    ) {
      throw new Error(
        `source attempt ${source.run_attempt} does not match expected attempt ${expected.runAttempt}`,
      );
    }

    const pullRequests = record.source_pull_requests;
    if (!Array.isArray(pullRequests))
      throw new Error("source_pull_requests must be an array");
    for (const pullRequest of pullRequests) {
      MainBuildStatsCodec.requireInteger(
        pullRequest.number,
        "source_pull_request.number",
      );
      MainBuildStatsCodec.requireString(
        pullRequest.url,
        "source_pull_request.url",
      );
      MainBuildStatsCodec.requireString(
        pullRequest.title,
        "source_pull_request.title",
      );
    }

    if (!Array.isArray(record.jobs)) throw new Error("jobs must be an array");
    const summary = record.summary;
    if (!summary || typeof summary !== "object")
      throw new Error("summary is required");
    /** @type {(keyof MainBuildSummary)[]} */
    const requiredSummaryFields = [
      "queue_seconds",
      "execution_seconds",
      "wall_seconds",
      "job_count",
      "step_count",
    ];
    for (const field of requiredSummaryFields) {
      MainBuildStatsCodec.requireInteger(summary[field], `summary.${field}`);
    }
    /** @type {(keyof MainBuildSummary)[]} */
    const optionalSummaryFields = [
      "build_seconds",
      "deployment_seconds",
      "coverage_seconds",
    ];
    for (const field of optionalSummaryFields) {
      if (field in summary)
        MainBuildStatsCodec.requireInteger(summary[field], `summary.${field}`);
    }
    if (summary.wall_seconds < summary.execution_seconds) {
      throw new Error("summary.wall_seconds must include execution_seconds");
    }
    if (summary.job_count !== record.jobs.length)
      throw new Error("summary.job_count mismatch");
    if (record.jobs.length === 0) {
      if (source.conclusion !== "cancelled") {
        throw new Error(
          "only cancelled Main attempts may have no executed jobs",
        );
      }
      if (
        summary.execution_seconds !== 0 ||
        summary.queue_seconds !== summary.wall_seconds
      ) {
        throw new Error(
          "cancelled Main attempts without jobs must record only queue time",
        );
      }
    }
    const stepCount = record.jobs.reduce(
      (total, job) => total + job.steps.length,
      0,
    );
    if (summary.step_count !== stepCount)
      throw new Error("summary.step_count mismatch");

    if (record.schema_version >= 2) {
      const telemetry = record.cache_telemetry;
      if (!telemetry || typeof telemetry !== "object") {
        throw new Error("cache_telemetry is required");
      }
      if (!Array.isArray(telemetry.jobs)) {
        throw new Error("cache_telemetry.jobs must be an array");
      }
      if (
        !telemetry.collection ||
        typeof telemetry.collection.complete !== "boolean"
      ) {
        throw new Error("cache_telemetry.collection is required");
      }
      if (!Array.isArray(telemetry.collection.warnings)) {
        throw new Error("cache_telemetry.collection.warnings must be an array");
      }
      const totals = telemetry.totals;
      if (!totals || typeof totals !== "object") {
        throw new Error("cache_telemetry.totals is required");
      }
      /** @type {(keyof MainBuildCacheTelemetry['totals'])[]} */
      const totalFields = [
        "job_count",
        "remote_backend_job_count",
        "direct_compile_job_count",
        "sccache_compile_requests",
        "sccache_cache_hits",
        "sccache_cache_misses",
        "buildkit_completed_steps",
        "buildkit_cached_steps",
      ];
      for (const field of totalFields) {
        MainBuildStatsCodec.requireInteger(
          totals[field],
          `cache_telemetry.totals.${field}`,
        );
      }
      if (totals.job_count !== telemetry.jobs.length) {
        throw new Error("cache_telemetry.totals.job_count mismatch");
      }
      for (const job of telemetry.jobs) {
        MainBuildStatsCodec.requireString(job.job, "cache_telemetry.job.job");
        CacheTelemetry.validateTelemetryRecord(
          {
            schema_version: 1,
            github: {
              run_id: String(source.run_id),
              run_attempt: source.run_attempt,
              job: job.job,
            },
            cache_backend: job.cache_backend,
            sccache: job.sccache,
            buildkit: job.buildkit,
            collection: job.collection,
          },
          { runId: source.run_id, runAttempt: source.run_attempt },
        );
      }
      const expected = this.cacheTelemetrySummary(
        telemetry.jobs.map((job) => ({
          schema_version: 1,
          github: {
            run_id: String(source.run_id),
            run_attempt: source.run_attempt,
            job: job.job,
          },
          cache_backend: job.cache_backend,
          sccache: job.sccache,
          buildkit: job.buildkit,
          collection: job.collection,
        })),
        { id: source.run_id, run_attempt: source.run_attempt },
      );
      if (!isDeepStrictEqual(expected.totals, totals)) {
        throw new Error("cache_telemetry.totals mismatch");
      }
    }

    const comparison = record.comparison;
    if (!comparison || typeof comparison !== "object")
      throw new Error("comparison is required");
    if (!Array.isArray(comparison.baseline_runs)) {
      throw new Error("comparison.baseline_runs must be an array");
    }
    MainBuildStatsCodec.requireString(
      comparison.baseline_quality,
      "comparison.baseline_quality",
    );
    MainBuildStatsCodec.requireString(
      comparison.baseline_note,
      "comparison.baseline_note",
    );
    /** @type {(keyof MainBuildComparison)[]} */
    const comparisonFields = [
      "wall_seconds_change_percent",
      "execution_seconds_change_percent",
      "build_seconds_change_percent",
    ];
    for (const field of comparisonFields) {
      if (field in comparison && !Number.isFinite(comparison[field])) {
        throw new Error(`comparison.${field} must be numeric when present`);
      }
    }
    if (typeof comparison.regression !== "boolean") {
      throw new Error("comparison.regression must be boolean");
    }
    if (!Array.isArray(comparison.regression_reasons)) {
      throw new Error("comparison.regression_reasons must be an array");
    }

    for (const job of record.jobs) {
      MainBuildStatsCodec.requireInteger(job.id, "job.id");
      MainBuildStatsCodec.requireString(job.name, "job.name");
      MainBuildStatsCodec.requireString(job.status, "job.status");
      if (!Array.isArray(job.labels))
        throw new Error("job.labels must be an array");
      if (!Array.isArray(job.steps))
        throw new Error("job.steps must be an array");
      if ("duration_seconds" in job) {
        MainBuildStatsCodec.requireInteger(
          job.duration_seconds,
          "job.duration_seconds",
        );
      }
      for (const step of job.steps) {
        MainBuildStatsCodec.requireInteger(step.number, "step.number");
        MainBuildStatsCodec.requireString(step.name, "step.name");
        MainBuildStatsCodec.requireString(step.status, "step.status");
        if ("duration_seconds" in step) {
          MainBuildStatsCodec.requireInteger(
            step.duration_seconds,
            "step.duration_seconds",
          );
        }
      }
    }

    return record;
  }

  /** @param {MainBuildRecord} record @returns {string} */
  static serialize(record) {
    this.validate(record);
    /** @type {(key: string, value: unknown) => unknown} */
    const replacer = (key, value) =>
      MainBuildStatsCodec.retainJsonValue(key, value);
    return `${JSON.stringify(record, replacer, 2)}\n`;
  }

  /** @param {unknown} record @returns {MainBuildRecord} */
  static normalizeLegacy(record) {
    if (!this.hasRecordStructure(record)) {
      throw new Error("record must contain Main build sections");
    }
    const normalized = structuredClone(record);
    const { jobs = [] } = normalized;

    if (normalized.schema_version < 3) {
      /** @type {(keyof MainBuildSummary)[]} */
      const summaryFields = [
        "build_seconds",
        "deployment_seconds",
        "coverage_seconds",
      ];
      for (const field of summaryFields) {
        if (!Number.isFinite(normalized.summary?.[field])) {
          delete normalized.summary?.[field];
        }
      }
      /** @type {(keyof MainBuildComparison)[]} */
      const comparisonFields = [
        "wall_seconds_change_percent",
        "execution_seconds_change_percent",
        "build_seconds_change_percent",
      ];
      for (const field of comparisonFields) {
        if (!Number.isFinite(normalized.comparison?.[field])) {
          delete normalized.comparison?.[field];
        }
      }
      for (const job of jobs) {
        if (!Number.isFinite(job.duration_seconds)) delete job.duration_seconds;
        const { steps = [] } = job;
        for (const step of steps) {
          if (!Number.isFinite(step.duration_seconds))
            delete step.duration_seconds;
        }
      }
      if (normalized.cache_telemetry) {
        const telemetryTotals = normalized.cache_telemetry.totals;
        const { jobs: telemetryJobs = [] } = normalized.cache_telemetry;
        /** @type {(keyof MainBuildCacheTelemetry['totals'])[]} */
        const telemetryFields = [
          "sccache_hit_rate_percent",
          "buildkit_cache_hit_rate_percent",
        ];
        for (const field of telemetryFields) {
          if (!Number.isFinite(telemetryTotals?.[field])) {
            delete telemetryTotals?.[field];
          }
        }
        for (const job of telemetryJobs) {
          if (!Number.isFinite(job.sccache?.hit_rate_percent)) {
            delete job.sccache?.hit_rate_percent;
          }
          if (!Number.isFinite(job.buildkit?.cache_hit_rate_percent)) {
            delete job.buildkit?.cache_hit_rate_percent;
          }
        }
      }
    }

    if (normalized.schema_version < 2 || !normalized.cache_telemetry)
      return normalized;

    const totals = normalized.cache_telemetry.totals;
    const { jobs: telemetryJobs = [] } = normalized.cache_telemetry;
    if (
      totals &&
      !("direct_compile_job_count" in totals) &&
      "local_fallback_job_count" in totals
    ) {
      totals.direct_compile_job_count = MainBuildStatsCodec.requireInteger(
        totals.local_fallback_job_count,
        "cache_telemetry.totals.local_fallback_job_count",
      );
      delete totals.local_fallback_job_count;
    }
    for (const job of telemetryJobs) {
      if (job.cache_backend?.kind === "local_fallback") {
        job.cache_backend.kind = "direct_compile";
      }
    }
    return normalized;
  }

  /** @param {string} path @param {MainBuildExpectation} [expected] @returns {MainBuildRecord} */
  static validateFile(path, expected = {}) {
    const record = this.normalizeLegacy(
      MainBuildStatsCodec.parseJson(fs.readFileSync(path, "utf8")),
    );
    this.validate(record, expected);
    return record;
  }
}

if (MainBuildStatsCodec.isEntrypoint(import.meta.url, process.argv[1])) {
  const [command, path] = process.argv.slice(2);
  if (command !== "--validate" || !path) {
    console.error(
      "usage: node .github/scripts/main-build-stats.mjs --validate <record.json>",
    );
    process.exit(2);
  }
  MainBuildStats.validateFile(path, {
    ...(process.env.SOURCE_RUN_ID
      ? { runId: Number(process.env.SOURCE_RUN_ID) }
      : {}),
    ...(process.env.SOURCE_RUN_ATTEMPT
      ? { runAttempt: Number(process.env.SOURCE_RUN_ATTEMPT) }
      : {}),
  });
  console.log(`validated ${path}`);
}
