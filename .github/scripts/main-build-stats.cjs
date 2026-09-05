const fs = require('node:fs')
const { isDeepStrictEqual } = require('node:util')
const { validateTelemetryRecord } = require('./cache-telemetry.cjs')

// Producer compile/verify work only. Browser suites are parallel consumers and must not
// inflate build_seconds relative to the historical single-job Main step.
const BUILD_STEPS = new Set([
  'Native Rust format, tests, and coverage',
  'WASM clippy, build, and package export',
  'WASM Node tests',
  'Svelte checks, JS unit tests, lint, and web build',
  // Legacy single-job Main step names retained for historical records.
  'Preflight, check, build, and e2e',
  'Preflight, check, build, and web e2e',
  'Preflight and build images',
])
const DEPLOYMENT_STEPS = new Set([
  'Build sealed web image for development deploy',
  'Deploy isolated development applications to Cloudflare Pages',
  'Configure and verify isolated development domains',
  'Record development deployment',
])
const COVERAGE_STEPS = new Set([
  'Export commit-keyed nook-core/auth coverage',
  'Upload commit-keyed nook-core/auth coverage',
])

function requireInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`)
  }
  return value
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

function timestampMilliseconds(value, label) {
  const timestamp = Date.parse(requireString(value, label))
  if (!Number.isFinite(timestamp))
    throw new Error(`${label} must be an ISO timestamp`)
  return timestamp
}

function durationSeconds(
  startedAt,
  completedAt,
  label,
  { negativeSkewToleranceMilliseconds = 0 } = {},
) {
  if (!startedAt || !completedAt) return { complete: false }
  const started = timestampMilliseconds(startedAt, `${label}.started_at`)
  const completed = timestampMilliseconds(completedAt, `${label}.completed_at`)
  if (completed < started) {
    if (started - completed <= negativeSkewToleranceMilliseconds) {
      return { complete: true, seconds: 0 }
    }
    throw new Error(`${label} completion precedes its start`)
  }
  return {
    complete: true,
    seconds: Math.round((completed - started) / 1000),
  }
}

function durationField(measurement) {
  return measurement.complete ? { duration_seconds: measurement.seconds } : {}
}

function maximumTimestamp(values, fallback) {
  const timestamps = values.filter(Boolean)
  if (timestamps.length === 0) return fallback
  return timestamps.reduce((latest, value) =>
    timestampMilliseconds(value, 'completion timestamp') >
    timestampMilliseconds(latest, 'completion timestamp')
      ? value
      : latest,
  )
}

function minimumTimestamp(values, fallback) {
  const timestamps = values.filter(Boolean)
  if (timestamps.length === 0) return fallback
  return timestamps.reduce((earliest, value) =>
    timestampMilliseconds(value, 'start timestamp') <
    timestampMilliseconds(earliest, 'start timestamp')
      ? value
      : earliest,
  )
}

function normalizeStep(step) {
  const duration = durationSeconds(
    step.started_at,
    step.completed_at,
    `step ${step.name}`,
  )
  return {
    number: requireInteger(step.number, 'step.number'),
    name: requireString(step.name, 'step.name'),
    status: requireString(step.status, 'step.status'),
    ...(step.conclusion ? { conclusion: step.conclusion } : {}),
    ...(step.started_at ? { started_at: step.started_at } : {}),
    ...(step.completed_at ? { completed_at: step.completed_at } : {}),
    ...durationField(duration),
  }
}

function normalizeJob(job) {
  const { steps: rawSteps = [] } = job
  const steps = rawSteps
    .map(normalizeStep)
    .sort((left, right) => left.number - right.number)
  const duration = durationSeconds(
    job.started_at,
    job.completed_at,
    `job ${job.name}`,
    {
      // GitHub can report a never-started skipped job as completing one second
      // before its nominal start when both timestamps are rounded to seconds.
      negativeSkewToleranceMilliseconds:
        job.conclusion === 'skipped' ? 1000 : 0,
    },
  )
  return {
    id: requireInteger(job.id, 'job.id'),
    name: requireString(job.name, 'job.name'),
    status: requireString(job.status, 'job.status'),
    ...(job.conclusion ? { conclusion: job.conclusion } : {}),
    ...(job.runner_name ? { runner_name: job.runner_name } : {}),
    ...(job.runner_group_name
      ? { runner_group_name: job.runner_group_name }
      : {}),
    labels: Array.isArray(job.labels) ? job.labels.map(String) : [],
    ...(job.started_at ? { started_at: job.started_at } : {}),
    ...(job.completed_at ? { completed_at: job.completed_at } : {}),
    ...durationField(duration),
    steps,
  }
}

function sumNamedStepSeconds(jobs, predicate) {
  const durations = jobs.flatMap((job) =>
    job.steps
      .filter((step) => predicate(step.name))
      .map((step) => step.duration_seconds),
  )
  if (
    durations.length === 0 ||
    durations.some((duration) => !Number.isInteger(duration))
  ) {
    return { complete: false }
  }
  return {
    complete: true,
    seconds: durations.reduce((total, duration) => total + duration, 0),
  }
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right)
  if (sorted.length === 0) {
    throw new Error('median requires at least one measured value')
  }
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

function metricComparison(current, baselines) {
  if (
    !Number.isFinite(current) ||
    baselines.length === 0 ||
    baselines.some((value) => !Number.isFinite(value))
  ) {
    return { regression: false }
  }
  const baseline = median(baselines)
  if (baseline === 0) {
    return { baseline, regression: false }
  }
  const changePercent =
    Math.round(((current - baseline) / baseline) * 1000) / 10
  return {
    baseline,
    changePercent,
    regression: current - baseline >= 60 && changePercent > 20,
  }
}

function cacheTelemetrySummary(cacheTelemetry, run) {
  const jobs = cacheTelemetry
    .map((record) =>
      validateTelemetryRecord(record, {
        runId: run.id,
        runAttempt: run.run_attempt,
      }),
    )
    .map((record) => ({
      job: record.github.job,
      cache_backend: record.cache_backend,
      sccache: record.sccache,
      buildkit: record.buildkit,
      collection: record.collection,
    }))
    .sort((left, right) => left.job.localeCompare(right.job))

  const total = (section, field) =>
    jobs.reduce((sum, job) => sum + job[section][field], 0)
  const sccacheHits = total('sccache', 'cache_hits')
  const sccacheMisses = total('sccache', 'cache_misses')
  const buildkitCompleted = total('buildkit', 'completed_steps')
  const buildkitCached = total('buildkit', 'cached_steps')
  const warnings =
    jobs.length === 0
      ? ['cache_telemetry_artifact_unavailable']
      : jobs.flatMap((job) => job.collection.warnings)

  return {
    totals: {
      job_count: jobs.length,
      remote_backend_job_count: jobs.filter(
        (job) => job.cache_backend.kind === 'remote',
      ).length,
      direct_compile_job_count: jobs.filter(
        (job) => job.cache_backend.kind === 'direct_compile',
      ).length,
      sccache_compile_requests: total('sccache', 'compile_requests'),
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
      complete: jobs.length > 0 && jobs.every((job) => job.collection.complete),
      warnings,
    },
  }
}

function addComparison(record, baselineRecords) {
  if (record.source_run.conclusion !== 'success') {
    return {
      ...record,
      comparison: {
        baseline_runs: [],
        baseline_quality: 'not_applicable',
        baseline_note:
          'Failed and cancelled attempts retain partial timings but are not compared with successful builds',
        regression: false,
        regression_reasons: [],
      },
    }
  }

  const currentCompletedAt = timestampMilliseconds(
    record.source_run.completed_at,
    'source_run.completed_at',
  )
  const baselines = baselineRecords
    .filter(
      (candidate) =>
        candidate.source_run?.workflow_id === record.source_run.workflow_id &&
        candidate.source_run?.conclusion === 'success' &&
        !(
          candidate.source_run?.run_id === record.source_run.run_id &&
          candidate.source_run?.run_attempt === record.source_run.run_attempt
        ) &&
        timestampMilliseconds(
          candidate.source_run.completed_at,
          'baseline.completed_at',
        ) < currentCompletedAt,
    )
    .sort(
      (left, right) =>
        timestampMilliseconds(
          right.source_run.completed_at,
          'baseline.completed_at',
        ) -
        timestampMilliseconds(
          left.source_run.completed_at,
          'baseline.completed_at',
        ),
    )
    .slice(0, 2)
  const wall = metricComparison(
    record.summary.wall_seconds,
    baselines.map((candidate) => candidate.summary.wall_seconds),
  )
  const execution = metricComparison(
    record.summary.execution_seconds,
    baselines.map((candidate) => candidate.summary.execution_seconds),
  )
  const build = metricComparison(
    record.summary.build_seconds,
    baselines.map((candidate) => candidate.summary.build_seconds),
  )
  const regressionReasons = []
  if (wall.regression)
    regressionReasons.push('wall_seconds_exceeded_baseline_threshold')
  if (execution.regression) {
    regressionReasons.push('execution_seconds_exceeded_baseline_threshold')
  }
  if (build.regression)
    regressionReasons.push('build_seconds_exceeded_baseline_threshold')

  return {
    ...record,
    comparison: {
      baseline_runs: baselines.map((candidate) => ({
        run_id: candidate.source_run.run_id,
        run_attempt: candidate.source_run.run_attempt,
      })),
      baseline_quality: baselines.length === 2 ? 'comparable' : 'weak',
      baseline_note:
        baselines.length === 0
          ? 'No earlier successful Main records are available'
          : baselines.length === 1
            ? 'Only one earlier successful Main record is available'
            : 'Two most recent successful Main attempts from the same workflow',
      ...('changePercent' in wall
        ? { wall_seconds_change_percent: wall.changePercent }
        : {}),
      ...('changePercent' in execution
        ? { execution_seconds_change_percent: execution.changePercent }
        : {}),
      ...('changePercent' in build
        ? { build_seconds_change_percent: build.changePercent }
        : {}),
      regression: regressionReasons.length > 0,
      regression_reasons: regressionReasons,
    },
  }
}

function buildMainBuildStats({
  run,
  jobs,
  sourcePullRequests = [],
  baselineRecords = [],
  cacheTelemetry = [],
  recordedAt,
}) {
  if (run.name !== 'Main')
    throw new Error(`expected Main workflow, got ${run.name}`)
  if (run.event !== 'push')
    throw new Error(`expected push event, got ${run.event}`)
  if (run.head_branch !== 'main')
    throw new Error(`expected main branch, got ${run.head_branch}`)

  const attemptStartedAt = run.run_started_at || run.created_at
  const attemptStartedMilliseconds = timestampMilliseconds(
    attemptStartedAt,
    'source_run.attempt_started_at',
  )
  const attemptJobs =
    run.run_attempt > 1
      ? jobs.filter((job) => {
          if (!job.started_at) return false
          const jobStartedMilliseconds = timestampMilliseconds(
            job.started_at,
            `job ${job.name}.started_at`,
          )
          // GitHub's rerun-attempt endpoint also returns successful jobs reused
          // from earlier attempts. Keep only jobs that actually ran in this
          // attempt, allowing one second for API timestamp rounding.
          return jobStartedMilliseconds >= attemptStartedMilliseconds - 1000
        })
      : jobs
  const hasExecutedJobs = attemptJobs.length > 0
  if (!hasExecutedJobs && run.conclusion !== 'cancelled') {
    throw new Error(`Main attempt ${run.run_attempt} has no executed jobs`)
  }

  const normalizedJobs = attemptJobs.map(normalizeJob).sort((left, right) => {
    if (!left.started_at) return 1
    if (!right.started_at) return -1
    return (
      timestampMilliseconds(left.started_at, 'job.started_at') -
      timestampMilliseconds(right.started_at, 'job.started_at')
    )
  })
  const earliestJobStartedAt = minimumTimestamp(
    normalizedJobs.map((job) => job.started_at),
    run.run_started_at || run.created_at,
  )
  const wallStartedAt = run.run_attempt > 1 ? attemptStartedAt : run.created_at
  const completedAt = maximumTimestamp(
    normalizedJobs.map((job) => job.completed_at),
    run.updated_at,
  )
  const startedAt = hasExecutedJobs
    ? run.run_attempt > 1
      ? earliestJobStartedAt
      : run.run_started_at || earliestJobStartedAt
    : completedAt
  const queueSeconds = durationSeconds(
    wallStartedAt,
    startedAt,
    'source_run.queue',
  )
  const executionSeconds = durationSeconds(
    startedAt,
    completedAt,
    'source_run.execution',
  )
  const wallSeconds = durationSeconds(
    wallStartedAt,
    completedAt,
    'source_run.wall',
  )
  if (
    !queueSeconds.complete ||
    !executionSeconds.complete ||
    !wallSeconds.complete
  ) {
    throw new Error('source run timestamps must produce complete durations')
  }
  const buildSeconds = sumNamedStepSeconds(normalizedJobs, (name) =>
    BUILD_STEPS.has(name),
  )
  const deploymentSeconds = sumNamedStepSeconds(normalizedJobs, (name) =>
    DEPLOYMENT_STEPS.has(name),
  )
  const coverageSeconds = sumNamedStepSeconds(normalizedJobs, (name) =>
    COVERAGE_STEPS.has(name),
  )

  const record = addComparison(
    {
      schema_version: 3,
      recorded_at: requireString(recordedAt, 'recorded_at'),
      source_run: {
        workflow_name: 'Main',
        workflow_id: requireInteger(run.workflow_id, 'source_run.workflow_id'),
        run_id: requireInteger(run.id, 'source_run.run_id'),
        run_attempt: requireInteger(run.run_attempt, 'source_run.run_attempt'),
        url: requireString(run.html_url, 'source_run.url'),
        event: 'push',
        head_branch: 'main',
        head_sha: requireString(run.head_sha, 'source_run.head_sha'),
        conclusion: requireString(run.conclusion, 'source_run.conclusion'),
        created_at: requireString(run.created_at, 'source_run.created_at'),
        started_at: startedAt,
        completed_at: completedAt,
      },
      source_pull_requests: sourcePullRequests.map((pullRequest) => ({
        number: requireInteger(
          pullRequest.number,
          'source_pull_request.number',
        ),
        url: requireString(pullRequest.html_url, 'source_pull_request.url'),
        title: requireString(pullRequest.title, 'source_pull_request.title'),
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
        ...(buildSeconds.complete
          ? { build_seconds: buildSeconds.seconds }
          : {}),
        ...(deploymentSeconds.complete
          ? { deployment_seconds: deploymentSeconds.seconds }
          : {}),
        ...(coverageSeconds.complete
          ? { coverage_seconds: coverageSeconds.seconds }
          : {}),
      },
      cache_telemetry: cacheTelemetrySummary(cacheTelemetry, run),
      jobs: normalizedJobs,
    },
    baselineRecords,
  )

  validateMainBuildStats(record)
  return record
}

function validateMainBuildStats(record, expected = {}) {
  if (!record || typeof record !== 'object')
    throw new Error('record must be an object')
  if (![1, 2, 3].includes(record.schema_version)) {
    throw new Error('schema_version must be 1, 2, or 3')
  }
  timestampMilliseconds(record.recorded_at, 'recorded_at')

  const source = record.source_run
  if (!source || typeof source !== 'object')
    throw new Error('source_run is required')
  if (source.workflow_name !== 'Main')
    throw new Error('source_run.workflow_name must be Main')
  if (source.event !== 'push') throw new Error('source_run.event must be push')
  if (source.head_branch !== 'main')
    throw new Error('source_run.head_branch must be main')
  requireInteger(source.workflow_id, 'source_run.workflow_id')
  requireInteger(source.run_id, 'source_run.run_id')
  requireInteger(source.run_attempt, 'source_run.run_attempt')
  requireString(source.url, 'source_run.url')
  requireString(source.head_sha, 'source_run.head_sha')
  requireString(source.conclusion, 'source_run.conclusion')
  timestampMilliseconds(source.created_at, 'source_run.created_at')
  timestampMilliseconds(source.started_at, 'source_run.started_at')
  timestampMilliseconds(source.completed_at, 'source_run.completed_at')

  if ('runId' in expected && source.run_id !== expected.runId) {
    throw new Error(
      `source run ${source.run_id} does not match expected run ${expected.runId}`,
    )
  }
  if ('runAttempt' in expected && source.run_attempt !== expected.runAttempt) {
    throw new Error(
      `source attempt ${source.run_attempt} does not match expected attempt ${expected.runAttempt}`,
    )
  }

  const pullRequests = record.source_pull_requests
  if (!Array.isArray(pullRequests))
    throw new Error('source_pull_requests must be an array')
  for (const pullRequest of pullRequests) {
    requireInteger(pullRequest.number, 'source_pull_request.number')
    requireString(pullRequest.url, 'source_pull_request.url')
    requireString(pullRequest.title, 'source_pull_request.title')
  }

  if (!Array.isArray(record.jobs)) throw new Error('jobs must be an array')
  const summary = record.summary
  if (!summary || typeof summary !== 'object')
    throw new Error('summary is required')
  for (const field of [
    'queue_seconds',
    'execution_seconds',
    'wall_seconds',
    'job_count',
    'step_count',
  ]) {
    requireInteger(summary[field], `summary.${field}`)
  }
  for (const field of [
    'build_seconds',
    'deployment_seconds',
    'coverage_seconds',
  ]) {
    if (field in summary) requireInteger(summary[field], `summary.${field}`)
  }
  if (summary.wall_seconds < summary.execution_seconds) {
    throw new Error('summary.wall_seconds must include execution_seconds')
  }
  if (summary.job_count !== record.jobs.length)
    throw new Error('summary.job_count mismatch')
  if (record.jobs.length === 0) {
    if (source.conclusion !== 'cancelled') {
      throw new Error('only cancelled Main attempts may have no executed jobs')
    }
    if (
      summary.execution_seconds !== 0 ||
      summary.queue_seconds !== summary.wall_seconds
    ) {
      throw new Error(
        'cancelled Main attempts without jobs must record only queue time',
      )
    }
  }
  const stepCount = record.jobs.reduce(
    (total, job) => total + job.steps.length,
    0,
  )
  if (summary.step_count !== stepCount)
    throw new Error('summary.step_count mismatch')

  if (record.schema_version >= 2) {
    const telemetry = record.cache_telemetry
    if (!telemetry || typeof telemetry !== 'object') {
      throw new Error('cache_telemetry is required')
    }
    if (!Array.isArray(telemetry.jobs)) {
      throw new Error('cache_telemetry.jobs must be an array')
    }
    if (
      !telemetry.collection ||
      typeof telemetry.collection.complete !== 'boolean'
    ) {
      throw new Error('cache_telemetry.collection is required')
    }
    if (!Array.isArray(telemetry.collection.warnings)) {
      throw new Error('cache_telemetry.collection.warnings must be an array')
    }
    const totals = telemetry.totals
    if (!totals || typeof totals !== 'object') {
      throw new Error('cache_telemetry.totals is required')
    }
    for (const field of [
      'job_count',
      'remote_backend_job_count',
      'direct_compile_job_count',
      'sccache_compile_requests',
      'sccache_cache_hits',
      'sccache_cache_misses',
      'buildkit_completed_steps',
      'buildkit_cached_steps',
    ]) {
      requireInteger(totals[field], `cache_telemetry.totals.${field}`)
    }
    if (totals.job_count !== telemetry.jobs.length) {
      throw new Error('cache_telemetry.totals.job_count mismatch')
    }
    for (const job of telemetry.jobs) {
      requireString(job.job, 'cache_telemetry.job.job')
      validateTelemetryRecord(
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
      )
    }
    const expected = cacheTelemetrySummary(
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
    )
    if (!isDeepStrictEqual(expected.totals, totals)) {
      throw new Error('cache_telemetry.totals mismatch')
    }
  }

  const comparison = record.comparison
  if (!comparison || typeof comparison !== 'object')
    throw new Error('comparison is required')
  if (!Array.isArray(comparison.baseline_runs)) {
    throw new Error('comparison.baseline_runs must be an array')
  }
  requireString(comparison.baseline_quality, 'comparison.baseline_quality')
  requireString(comparison.baseline_note, 'comparison.baseline_note')
  for (const field of [
    'wall_seconds_change_percent',
    'execution_seconds_change_percent',
    'build_seconds_change_percent',
  ]) {
    if (field in comparison && !Number.isFinite(comparison[field])) {
      throw new Error(`comparison.${field} must be numeric when present`)
    }
  }
  if (typeof comparison.regression !== 'boolean') {
    throw new Error('comparison.regression must be boolean')
  }
  if (!Array.isArray(comparison.regression_reasons)) {
    throw new Error('comparison.regression_reasons must be an array')
  }

  for (const job of record.jobs) {
    requireInteger(job.id, 'job.id')
    requireString(job.name, 'job.name')
    requireString(job.status, 'job.status')
    if (!Array.isArray(job.labels))
      throw new Error('job.labels must be an array')
    if (!Array.isArray(job.steps)) throw new Error('job.steps must be an array')
    if ('duration_seconds' in job) {
      requireInteger(job.duration_seconds, 'job.duration_seconds')
    }
    for (const step of job.steps) {
      requireInteger(step.number, 'step.number')
      requireString(step.name, 'step.name')
      requireString(step.status, 'step.status')
      if ('duration_seconds' in step) {
        requireInteger(step.duration_seconds, 'step.duration_seconds')
      }
    }
  }

  return record
}

function serializeMainBuildStats(record) {
  validateMainBuildStats(record)
  return `${JSON.stringify(record, (_key, nestedValue) => nestedValue, 2)}\n`
}

function normalizeLegacyMainBuildStats(record) {
  const normalized = structuredClone(record)
  const { jobs = [] } = normalized

  if (normalized.schema_version < 3) {
    for (const field of [
      'build_seconds',
      'deployment_seconds',
      'coverage_seconds',
    ]) {
      if (!Number.isFinite(normalized.summary?.[field])) {
        delete normalized.summary?.[field]
      }
    }
    for (const field of [
      'wall_seconds_change_percent',
      'execution_seconds_change_percent',
      'build_seconds_change_percent',
    ]) {
      if (!Number.isFinite(normalized.comparison?.[field])) {
        delete normalized.comparison?.[field]
      }
    }
    for (const job of jobs) {
      if (!Number.isFinite(job.duration_seconds)) delete job.duration_seconds
      const { steps = [] } = job
      for (const step of steps) {
        if (!Number.isFinite(step.duration_seconds))
          delete step.duration_seconds
      }
    }
    if (normalized.cache_telemetry) {
      const telemetryTotals = normalized.cache_telemetry.totals
      const { jobs: telemetryJobs = [] } = normalized.cache_telemetry
      for (const field of [
        'sccache_hit_rate_percent',
        'buildkit_cache_hit_rate_percent',
      ]) {
        if (!Number.isFinite(telemetryTotals?.[field])) {
          delete telemetryTotals?.[field]
        }
      }
      for (const job of telemetryJobs) {
        if (!Number.isFinite(job.sccache?.hit_rate_percent)) {
          delete job.sccache?.hit_rate_percent
        }
        if (!Number.isFinite(job.buildkit?.cache_hit_rate_percent)) {
          delete job.buildkit?.cache_hit_rate_percent
        }
      }
    }
  }

  if (normalized.schema_version < 2 || !normalized.cache_telemetry)
    return normalized

  const totals = normalized.cache_telemetry.totals
  const { jobs: telemetryJobs = [] } = normalized.cache_telemetry
  if (
    totals &&
    !('direct_compile_job_count' in totals) &&
    'local_fallback_job_count' in totals
  ) {
    totals.direct_compile_job_count = totals.local_fallback_job_count
    delete totals.local_fallback_job_count
  }
  for (const job of telemetryJobs) {
    if (job.cache_backend?.kind === 'local_fallback') {
      job.cache_backend.kind = 'direct_compile'
    }
  }
  return normalized
}

function validateFile(path, expected = {}) {
  const record = normalizeLegacyMainBuildStats(
    JSON.parse(fs.readFileSync(path, 'utf8')),
  )
  validateMainBuildStats(record, expected)
  return record
}

if (require.main === module) {
  const [command, path] = process.argv.slice(2)
  if (command !== '--validate' || !path) {
    console.error(
      'usage: node .github/scripts/main-build-stats.cjs --validate <record.yaml>',
    )
    process.exit(2)
  }
  validateFile(path, {
    ...(process.env.SOURCE_RUN_ID
      ? { runId: Number(process.env.SOURCE_RUN_ID) }
      : {}),
    ...(process.env.SOURCE_RUN_ATTEMPT
      ? { runAttempt: Number(process.env.SOURCE_RUN_ATTEMPT) }
      : {}),
  })
  console.log(`validated ${path}`)
}

module.exports = {
  BUILD_STEPS,
  addComparison,
  buildMainBuildStats,
  normalizeLegacyMainBuildStats,
  serializeMainBuildStats,
  validateFile,
  validateMainBuildStats,
}
