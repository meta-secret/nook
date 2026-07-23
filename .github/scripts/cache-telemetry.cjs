const fs = require('node:fs')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')

const SCCACHE_MARKER = 'NOOK_SCCACHE_STATS '

function parseJsonObjects(text) {
  const trimmed = text.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('[')) return JSON.parse(trimmed)
  return trimmed
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function parseRawJsonProgress(text) {
  const objects = []
  const diagnostics = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line)
      if (Array.isArray(parsed)) objects.push(...parsed)
      else objects.push(parsed)
    } catch {
      diagnostics.push(line)
    }
  }
  return { objects, diagnostics }
}

function nonNegativeInteger(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}

function percentage(numerator, denominator) {
  if (denominator === 0) return null
  return Math.round((numerator / denominator) * 10_000) / 100
}

function normalizeBuildRecord(record) {
  const completedSteps = nonNegativeInteger(
    record.completed_steps ?? record.NumCompletedSteps,
  )
  const cachedSteps = nonNegativeInteger(record.cached_steps ?? record.NumCachedSteps)
  return {
    ref: String(record.ref ?? record.Ref ?? ''),
    name: String(record.name ?? record.Name ?? ''),
    status: String(record.status ?? record.Status ?? '').toLowerCase(),
    started_at: record.created_at ?? record.StartedAt ?? null,
    completed_at: record.completed_at ?? record.CompletedAt ?? null,
    completed_steps: completedSteps,
    total_steps: nonNegativeInteger(record.total_steps ?? record.NumTotalSteps),
    cached_steps: cachedSteps,
    cache_hit_rate_percent: percentage(cachedSteps, completedSteps),
  }
}

function historyLogRef(ref) {
  return String(ref).split('/').filter(Boolean).pop() ?? ''
}

function normalizeSccacheReport(report) {
  const normalized = {
    stage: String(report.stage ?? ''),
    compile_requests: nonNegativeInteger(report.compile_requests),
    requests_executed: nonNegativeInteger(report.requests_executed),
    cache_hits: nonNegativeInteger(report.cache_hits),
    cache_misses: nonNegativeInteger(report.cache_misses),
    cache_errors: nonNegativeInteger(report.cache_errors),
    cache_writes: nonNegativeInteger(report.cache_writes),
  }
  if (!normalized.stage) throw new Error('sccache report is missing its stage')
  return normalized
}

function summarizeSccache(reports) {
  const summary = {
    report_count: reports.length,
    compile_requests: 0,
    requests_executed: 0,
    cache_hits: 0,
    cache_misses: 0,
    cache_errors: 0,
    cache_writes: 0,
    hit_rate_percent: null,
  }
  for (const report of reports) {
    for (const key of [
      'compile_requests',
      'requests_executed',
      'cache_hits',
      'cache_misses',
      'cache_errors',
      'cache_writes',
    ]) {
      summary[key] += report[key]
    }
  }
  summary.hit_rate_percent = percentage(
    summary.cache_hits,
    summary.cache_hits + summary.cache_misses,
  )
  return summary
}

function summarizeBuildkit(records) {
  const completedSteps = records.reduce(
    (total, record) => total + record.completed_steps,
    0,
  )
  const cachedSteps = records.reduce((total, record) => total + record.cached_steps, 0)
  return {
    build_record_count: records.length,
    completed_steps: completedSteps,
    cached_steps: cachedSteps,
    cache_hit_rate_percent: percentage(cachedSteps, completedSteps),
    measurement: 'buildx_target_record_steps',
  }
}

function extractSccacheReports(events, seen = new Set()) {
  const reports = []
  const buffers = new Map()

  function inspectLine(line, log) {
    const markerAt = line.indexOf(SCCACHE_MARKER)
    if (markerAt === -1) return
    const payload = line.slice(markerAt + SCCACHE_MARKER.length).trim()
    const identity = `${log.vertex ?? ''}:${log.timestamp ?? ''}:${payload}`
    if (seen.has(identity)) return
    seen.add(identity)
    reports.push(normalizeSccacheReport(JSON.parse(payload)))
  }

  for (const event of events) {
    for (const log of event.logs ?? []) {
      const key = `${log.vertex ?? ''}`
      const decoded = Buffer.from(log.data ?? '', 'base64').toString('utf8')
      const lines = `${buffers.get(key) ?? ''}${decoded}`.split(/\r?\n/)
      buffers.set(key, lines.pop() ?? '')
      for (const line of lines) inspectLine(line, log)
    }
  }
  for (const [key, line] of buffers) {
    inspectLine(line, { vertex: key, timestamp: 'unterminated' })
  }
  return reports
}

function listBuildHistory() {
  const result = spawnSync(
    'docker',
    ['buildx', 'history', 'ls', '--format', 'json', '--no-trunc'],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  )
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `buildx history exited ${result.status}`)
  }
  return parseJsonObjects(result.stdout).map(normalizeBuildRecord)
}

function readHistoryEvents(ref) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', [
      'buildx',
      'history',
      'logs',
      historyLogRef(ref),
      '--progress',
      'rawjson',
    ])
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (status) => {
      const parsedStdout = parseRawJsonProgress(stdout)
      const parsedStderr = parseRawJsonProgress(stderr)
      const events = [...parsedStdout.objects, ...parsedStderr.objects]
      const diagnostics = [
        ...parsedStdout.diagnostics,
        ...parsedStderr.diagnostics,
      ]
      if (status === 0 && (events.length > 0 || diagnostics.length === 0)) {
        resolve(events)
      } else {
        reject(
          new Error(
            diagnostics.join('\n') ||
              stderr.trim() ||
              `buildx history logs exited ${status}`,
          ),
        )
      }
    })
  })
}

function cacheBackendFromEnvironment(environment = process.env) {
  const kind = environment.NOOK_SCCACHE_BACKEND === 'remote' ? 'remote' : 'direct_compile'
  return {
    kind,
    persistent: kind === 'remote',
    reason:
      environment.NOOK_SCCACHE_BACKEND_REASON ||
      (kind === 'remote' ? 'persistent_service' : 'credentials_unavailable'),
  }
}

function validateTelemetryRecord(record, expected = {}) {
  if (!record || typeof record !== 'object') throw new Error('telemetry record is required')
  if (record.schema_version !== 1) throw new Error('telemetry schema_version must be 1')
  if (!record.github || typeof record.github !== 'object') {
    throw new Error('telemetry github context is required')
  }
  if (typeof record.github.run_id !== 'string') {
    throw new Error('telemetry github.run_id must be a string')
  }
  if (!Number.isInteger(record.github.run_attempt) || record.github.run_attempt < 1) {
    throw new Error('telemetry github.run_attempt must be a positive integer')
  }
  if (typeof record.github.job !== 'string' || !record.github.job) {
    throw new Error('telemetry github.job must be a non-empty string')
  }
  if (
    expected.runId !== undefined &&
    record.github.run_id !== String(expected.runId)
  ) {
    throw new Error(
      `telemetry run ${record.github.run_id} does not match expected run ${expected.runId}`,
    )
  }
  if (
    expected.runAttempt !== undefined &&
    record.github.run_attempt !== Number(expected.runAttempt)
  ) {
    throw new Error(
      `telemetry attempt ${record.github.run_attempt} does not match expected attempt ${expected.runAttempt}`,
    )
  }
  if (!['remote', 'direct_compile'].includes(record.cache_backend?.kind)) {
    throw new Error('telemetry cache_backend.kind is invalid')
  }
  if (typeof record.cache_backend.persistent !== 'boolean') {
    throw new Error('telemetry cache_backend.persistent must be boolean')
  }
  if (
    record.cache_backend.persistent !==
    (record.cache_backend.kind === 'remote')
  ) {
    throw new Error('telemetry cache backend persistence is inconsistent')
  }
  if (typeof record.cache_backend.reason !== 'string' || !record.cache_backend.reason) {
    throw new Error('telemetry cache_backend.reason is required')
  }
  for (const [section, fields] of [
    [
      'sccache',
      [
        'report_count',
        'compile_requests',
        'requests_executed',
        'cache_hits',
        'cache_misses',
        'cache_errors',
        'cache_writes',
      ],
    ],
    ['buildkit', ['build_record_count', 'completed_steps', 'cached_steps']],
  ]) {
    if (!record[section] || typeof record[section] !== 'object') {
      throw new Error(`telemetry ${section} summary is required`)
    }
    for (const field of fields) {
      if (
        !Number.isInteger(record[section][field]) ||
        record[section][field] < 0
      ) {
        throw new Error(`telemetry ${section}.${field} must be a non-negative integer`)
      }
    }
    const rate =
      section === 'sccache'
        ? record[section].hit_rate_percent
        : record[section].cache_hit_rate_percent
    if (rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > 100)) {
      throw new Error(`telemetry ${section} cache rate must be null or 0..100`)
    }
  }
  if (!record.collection || typeof record.collection.complete !== 'boolean') {
    throw new Error('telemetry collection status is required')
  }
  if (!Array.isArray(record.collection.warnings)) {
    throw new Error('telemetry collection.warnings must be an array')
  }
  return record
}

async function collectTelemetry({
  baselineRefs,
  baselineWarnings = [],
  job,
  runId,
  runAttempt,
  environment = process.env,
}) {
  const warnings = [...baselineWarnings]
  let records = []
  try {
    const baseline = new Set(baselineRefs)
    records = listBuildHistory().filter((record) => record.ref && !baseline.has(record.ref))
  } catch (error) {
    warnings.push(`buildx_history_unavailable: ${error.message}`)
  }

  const reports = []
  const seenReports = new Set()
  for (const record of records) {
    try {
      reports.push(
        ...extractSccacheReports(await readHistoryEvents(record.ref), seenReports),
      )
    } catch (error) {
      warnings.push(`buildx_logs_unavailable:${record.ref}: ${error.message}`)
    }
  }

  return {
    schema_version: 1,
    github: {
      run_id: String(runId ?? ''),
      run_attempt: nonNegativeInteger(runAttempt, 1),
      job: String(job ?? ''),
    },
    cache_backend: cacheBackendFromEnvironment(environment),
    sccache: summarizeSccache(reports),
    buildkit: summarizeBuildkit(records),
    buildkit_records: records,
    collection: {
      complete: warnings.length === 0,
      warnings,
    },
  }
}

function writeJson(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true })
  fs.writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`)
}

function appendJobSummary(record, filename = process.env.GITHUB_STEP_SUMMARY) {
  if (!filename) return
  const compilerRate =
    record.sccache.hit_rate_percent === null
      ? 'n/a (no executed cacheable compiler requests)'
      : `${record.sccache.hit_rate_percent}%`
  const buildkitRate =
    record.buildkit.cache_hit_rate_percent === null
      ? 'n/a (no completed Buildx steps)'
      : `${record.buildkit.cache_hit_rate_percent}%`
  fs.appendFileSync(
    filename,
    [
      '### Cache telemetry',
      '',
      `- sccache backend: \`${record.cache_backend.kind}\` (${record.cache_backend.reason})`,
      `- sccache hit rate: ${compilerRate} (${record.sccache.cache_hits} hits / ${record.sccache.cache_hits + record.sccache.cache_misses} lookups)`,
      `- BuildKit target-step cache rate: ${buildkitRate} (${record.buildkit.cached_steps} cached / ${record.buildkit.completed_steps} completed)`,
      '',
    ].join('\n'),
  )
}

function argumentValue(arguments_, name) {
  const index = arguments_.indexOf(name)
  if (index === -1 || !arguments_[index + 1]) throw new Error(`${name} is required`)
  return arguments_[index + 1]
}

async function main(arguments_ = process.argv.slice(2)) {
  const command = arguments_[0]
  const output = argumentValue(arguments_, '--output')
  if (command === 'start') {
    const warnings = []
    let refs = []
    try {
      refs = listBuildHistory().map((record) => record.ref).filter(Boolean)
    } catch (error) {
      warnings.push(`buildx_history_unavailable: ${error.message}`)
    }
    writeJson(output, { schema_version: 1, refs, warnings })
    return
  }
  if (command !== 'collect') throw new Error('expected start or collect')

  const baseline = JSON.parse(fs.readFileSync(argumentValue(arguments_, '--baseline'), 'utf8'))
  const record = await collectTelemetry({
    baselineRefs: baseline.refs ?? [],
    baselineWarnings: baseline.warnings ?? [],
    job: process.env.GITHUB_JOB,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
  })
  validateTelemetryRecord(record)
  writeJson(output, record)
  appendJobSummary(record)
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`cache telemetry: ${error.stack || error.message}\n`)
    process.exitCode = 1
  })
}

module.exports = {
  cacheBackendFromEnvironment,
  extractSccacheReports,
  historyLogRef,
  normalizeBuildRecord,
  parseJsonObjects,
  parseRawJsonProgress,
  percentage,
  summarizeBuildkit,
  summarizeSccache,
  validateTelemetryRecord,
}
