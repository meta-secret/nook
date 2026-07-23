const fs = require('node:fs')
const { validateTelemetryRecord } = require('./cache-telemetry.cjs')

const BUILD_STEP = 'Preflight, check, build, and e2e'
const DEPLOYMENT_STEPS = new Set([
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
  if (!Number.isFinite(timestamp)) throw new Error(`${label} must be an ISO timestamp`)
  return timestamp
}

function durationSeconds(startedAt, completedAt, label) {
  if (!startedAt || !completedAt) return null
  const started = timestampMilliseconds(startedAt, `${label}.started_at`)
  const completed = timestampMilliseconds(completedAt, `${label}.completed_at`)
  if (completed < started) throw new Error(`${label} completion precedes its start`)
  return Math.round((completed - started) / 1000)
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
  return {
    number: requireInteger(step.number, 'step.number'),
    name: requireString(step.name, 'step.name'),
    status: requireString(step.status, 'step.status'),
    conclusion: step.conclusion ?? null,
    started_at: step.started_at ?? null,
    completed_at: step.completed_at ?? null,
    duration_seconds: durationSeconds(step.started_at, step.completed_at, `step ${step.name}`),
  }
}

function normalizeJob(job) {
  const steps = (job.steps ?? []).map(normalizeStep).sort((left, right) => left.number - right.number)
  return {
    id: requireInteger(job.id, 'job.id'),
    name: requireString(job.name, 'job.name'),
    status: requireString(job.status, 'job.status'),
    conclusion: job.conclusion ?? null,
    runner_name: job.runner_name || null,
    runner_group_name: job.runner_group_name || null,
    labels: Array.isArray(job.labels) ? job.labels.map(String) : [],
    started_at: job.started_at ?? null,
    completed_at: job.completed_at ?? null,
    duration_seconds: durationSeconds(job.started_at, job.completed_at, `job ${job.name}`),
    steps,
  }
}

function sumNamedStepSeconds(jobs, predicate) {
  const durations = jobs.flatMap((job) =>
    job.steps.filter((step) => predicate(step.name)).map((step) => step.duration_seconds),
  )
  if (durations.length === 0 || durations.some((duration) => duration === null)) return null
  return durations.reduce((total, duration) => total + duration, 0)
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right)
  if (sorted.length === 0) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function metricComparison(current, baselines) {
  if (current === null || baselines.some((value) => value === null)) {
    return { baseline: null, changePercent: null, regression: false }
  }
  const baseline = median(baselines)
  if (baseline === null || baseline === 0) {
    return { baseline, changePercent: null, regression: false }
  }
  const changePercent = Math.round(((current - baseline) / baseline) * 1000) / 10
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
      local_fallback_job_count: jobs.filter(
        (job) => job.cache_backend.kind === 'local_fallback',
      ).length,
      sccache_compile_requests: total('sccache', 'compile_requests'),
      sccache_cache_hits: sccacheHits,
      sccache_cache_misses: sccacheMisses,
      sccache_hit_rate_percent:
        sccacheHits + sccacheMisses === 0
          ? null
          : Math.round((sccacheHits / (sccacheHits + sccacheMisses)) * 10_000) /
            100,
      buildkit_completed_steps: buildkitCompleted,
      buildkit_cached_steps: buildkitCached,
      buildkit_cache_hit_rate_percent:
        buildkitCompleted === 0
          ? null
          : Math.round((buildkitCached / buildkitCompleted) * 10_000) / 100,
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
        baseline_note: 'Failed and cancelled attempts retain partial timings but are not compared with successful builds',
        wall_seconds_change_percent: null,
        execution_seconds_change_percent: null,
        build_seconds_change_percent: null,
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
        timestampMilliseconds(candidate.source_run.completed_at, 'baseline.completed_at') <
          currentCompletedAt,
    )
    .sort(
      (left, right) =>
        timestampMilliseconds(right.source_run.completed_at, 'baseline.completed_at') -
        timestampMilliseconds(left.source_run.completed_at, 'baseline.completed_at'),
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
  if (wall.regression) regressionReasons.push('wall_seconds_exceeded_baseline_threshold')
  if (execution.regression) {
    regressionReasons.push('execution_seconds_exceeded_baseline_threshold')
  }
  if (build.regression) regressionReasons.push('build_seconds_exceeded_baseline_threshold')

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
      wall_seconds_change_percent: wall.changePercent,
      execution_seconds_change_percent: execution.changePercent,
      build_seconds_change_percent: build.changePercent,
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
  if (run.name !== 'Main') throw new Error(`expected Main workflow, got ${run.name}`)
  if (run.event !== 'push') throw new Error(`expected push event, got ${run.event}`)
  if (run.head_branch !== 'main') throw new Error(`expected main branch, got ${run.head_branch}`)

  const normalizedJobs = jobs
    .map(normalizeJob)
    .sort((left, right) => {
      if (!left.started_at) return 1
      if (!right.started_at) return -1
      return timestampMilliseconds(left.started_at, 'job.started_at') -
        timestampMilliseconds(right.started_at, 'job.started_at')
    })
  const earliestJobStartedAt = minimumTimestamp(
    normalizedJobs.map((job) => job.started_at),
    run.run_started_at || run.created_at,
  )
  const startedAt = run.run_attempt > 1
    ? earliestJobStartedAt
    : run.run_started_at || earliestJobStartedAt
  const wallStartedAt = run.run_attempt > 1
    ? run.run_started_at || earliestJobStartedAt
    : run.created_at
  const completedAt = maximumTimestamp(
    normalizedJobs.map((job) => job.completed_at),
    run.updated_at,
  )
  const queueSeconds = durationSeconds(wallStartedAt, startedAt, 'source_run.queue')
  const executionSeconds = durationSeconds(startedAt, completedAt, 'source_run.execution')
  const wallSeconds = durationSeconds(wallStartedAt, completedAt, 'source_run.wall')

  const record = addComparison({
    schema_version: 2,
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
      number: requireInteger(pullRequest.number, 'source_pull_request.number'),
      url: requireString(pullRequest.html_url, 'source_pull_request.url'),
      title: requireString(pullRequest.title, 'source_pull_request.title'),
    })),
    summary: {
      queue_seconds: queueSeconds,
      execution_seconds: executionSeconds,
      wall_seconds: wallSeconds,
      job_count: normalizedJobs.length,
      step_count: normalizedJobs.reduce((total, job) => total + job.steps.length, 0),
      build_seconds: sumNamedStepSeconds(normalizedJobs, (name) => name === BUILD_STEP),
      deployment_seconds: sumNamedStepSeconds(normalizedJobs, (name) =>
        DEPLOYMENT_STEPS.has(name),
      ),
      coverage_seconds: sumNamedStepSeconds(normalizedJobs, (name) => COVERAGE_STEPS.has(name)),
    },
    cache_telemetry: cacheTelemetrySummary(cacheTelemetry, run),
    jobs: normalizedJobs,
  }, baselineRecords)

  validateMainBuildStats(record)
  return record
}

function validateMainBuildStats(record, expected = {}) {
  if (!record || typeof record !== 'object') throw new Error('record must be an object')
  if (![1, 2].includes(record.schema_version)) {
    throw new Error('schema_version must be 1 or 2')
  }
  timestampMilliseconds(record.recorded_at, 'recorded_at')

  const source = record.source_run
  if (!source || typeof source !== 'object') throw new Error('source_run is required')
  if (source.workflow_name !== 'Main') throw new Error('source_run.workflow_name must be Main')
  if (source.event !== 'push') throw new Error('source_run.event must be push')
  if (source.head_branch !== 'main') throw new Error('source_run.head_branch must be main')
  requireInteger(source.workflow_id, 'source_run.workflow_id')
  requireInteger(source.run_id, 'source_run.run_id')
  requireInteger(source.run_attempt, 'source_run.run_attempt')
  requireString(source.url, 'source_run.url')
  requireString(source.head_sha, 'source_run.head_sha')
  requireString(source.conclusion, 'source_run.conclusion')
  timestampMilliseconds(source.created_at, 'source_run.created_at')
  timestampMilliseconds(source.started_at, 'source_run.started_at')
  timestampMilliseconds(source.completed_at, 'source_run.completed_at')

  if (expected.runId !== undefined && source.run_id !== expected.runId) {
    throw new Error(`source run ${source.run_id} does not match expected run ${expected.runId}`)
  }
  if (expected.runAttempt !== undefined && source.run_attempt !== expected.runAttempt) {
    throw new Error(
      `source attempt ${source.run_attempt} does not match expected attempt ${expected.runAttempt}`,
    )
  }

  const pullRequests = record.source_pull_requests
  if (!Array.isArray(pullRequests)) throw new Error('source_pull_requests must be an array')
  for (const pullRequest of pullRequests) {
    requireInteger(pullRequest.number, 'source_pull_request.number')
    requireString(pullRequest.url, 'source_pull_request.url')
    requireString(pullRequest.title, 'source_pull_request.title')
  }

  if (!Array.isArray(record.jobs)) throw new Error('jobs must be an array')
  const summary = record.summary
  if (!summary || typeof summary !== 'object') throw new Error('summary is required')
  for (const field of [
    'queue_seconds',
    'execution_seconds',
    'wall_seconds',
    'job_count',
    'step_count',
  ]) {
    requireInteger(summary[field], `summary.${field}`)
  }
  for (const field of ['build_seconds', 'deployment_seconds', 'coverage_seconds']) {
    if (summary[field] !== null) requireInteger(summary[field], `summary.${field}`)
  }
  if (summary.wall_seconds < summary.execution_seconds) {
    throw new Error('summary.wall_seconds must include execution_seconds')
  }
  if (summary.job_count !== record.jobs.length) throw new Error('summary.job_count mismatch')
  const stepCount = record.jobs.reduce((total, job) => total + job.steps.length, 0)
  if (summary.step_count !== stepCount) throw new Error('summary.step_count mismatch')

  if (record.schema_version >= 2) {
    const telemetry = record.cache_telemetry
    if (!telemetry || typeof telemetry !== 'object') {
      throw new Error('cache_telemetry is required')
    }
    if (!Array.isArray(telemetry.jobs)) {
      throw new Error('cache_telemetry.jobs must be an array')
    }
    if (!telemetry.collection || typeof telemetry.collection.complete !== 'boolean') {
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
      'local_fallback_job_count',
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
    if (JSON.stringify(expected.totals) !== JSON.stringify(totals)) {
      throw new Error('cache_telemetry.totals mismatch')
    }
  }

  const comparison = record.comparison
  if (!comparison || typeof comparison !== 'object') throw new Error('comparison is required')
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
    if (comparison[field] !== null && !Number.isFinite(comparison[field])) {
      throw new Error(`comparison.${field} must be a number or null`)
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
    if (!Array.isArray(job.labels)) throw new Error('job.labels must be an array')
    if (!Array.isArray(job.steps)) throw new Error('job.steps must be an array')
    if (job.duration_seconds !== null) requireInteger(job.duration_seconds, 'job.duration_seconds')
    for (const step of job.steps) {
      requireInteger(step.number, 'step.number')
      requireString(step.name, 'step.name')
      requireString(step.status, 'step.status')
      if (step.duration_seconds !== null) {
        requireInteger(step.duration_seconds, 'step.duration_seconds')
      }
    }
  }

  return record
}

function serializeMainBuildStats(record) {
  validateMainBuildStats(record)
  return `${JSON.stringify(record, null, 2)}\n`
}

function validateFile(path, expected = {}) {
  const record = JSON.parse(fs.readFileSync(path, 'utf8'))
  validateMainBuildStats(record, expected)
  return record
}

if (require.main === module) {
  const [command, path] = process.argv.slice(2)
  if (command !== '--validate' || !path) {
    console.error('usage: node .github/scripts/main-build-stats.cjs --validate <record.yaml>')
    process.exit(2)
  }
  validateFile(path, {
    runId: process.env.SOURCE_RUN_ID ? Number(process.env.SOURCE_RUN_ID) : undefined,
    runAttempt: process.env.SOURCE_RUN_ATTEMPT
      ? Number(process.env.SOURCE_RUN_ATTEMPT)
      : undefined,
  })
  console.log(`validated ${path}`)
}

module.exports = {
  BUILD_STEP,
  addComparison,
  buildMainBuildStats,
  serializeMainBuildStats,
  validateFile,
  validateMainBuildStats,
}
