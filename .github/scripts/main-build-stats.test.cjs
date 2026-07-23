const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const {
  buildMainBuildStats,
  normalizeLegacyMainBuildStats,
  serializeMainBuildStats,
  validateMainBuildStats,
} = require('./main-build-stats.cjs')

function fixture() {
  return {
    run: {
      name: 'Main',
      workflow_id: 77,
      id: 123456,
      run_attempt: 1,
      html_url: 'https://github.com/meta-secret/nook/actions/runs/123456',
      event: 'push',
      head_branch: 'main',
      head_sha: '0123456789abcdef0123456789abcdef01234567',
      conclusion: 'success',
      created_at: '2026-07-22T10:00:00Z',
      run_started_at: '2026-07-22T10:02:00Z',
      updated_at: '2026-07-22T10:21:00Z',
    },
    jobs: [
      {
        id: 9001,
        name: 'Check, build, e2e, and deploy dev',
        status: 'completed',
        conclusion: 'success',
        runner_name: 'GitHub Actions 1',
        runner_group_name: 'GitHub Actions',
        labels: ['ubuntu-latest'],
        started_at: '2026-07-22T10:02:00Z',
        completed_at: '2026-07-22T10:20:00Z',
        steps: [
          {
            number: 1,
            name: 'Checkout',
            status: 'completed',
            conclusion: 'success',
            started_at: '2026-07-22T10:02:00Z',
            completed_at: '2026-07-22T10:03:00Z',
          },
          {
            number: 2,
            name: 'Preflight, check, build, and e2e',
            status: 'completed',
            conclusion: 'success',
            started_at: '2026-07-22T10:03:00Z',
            completed_at: '2026-07-22T10:13:00Z',
          },
          {
            number: 3,
            name: 'Deploy isolated development applications to Cloudflare Pages',
            status: 'completed',
            conclusion: 'success',
            started_at: '2026-07-22T10:13:00Z',
            completed_at: '2026-07-22T10:15:00Z',
          },
          {
            number: 4,
            name: 'Export commit-keyed nook-core/auth coverage',
            status: 'completed',
            conclusion: 'success',
            started_at: '2026-07-22T10:15:00Z',
            completed_at: '2026-07-22T10:15:30Z',
          },
        ],
      },
    ],
    sourcePullRequests: [
      {
        number: 700,
        html_url: 'https://github.com/meta-secret/nook/pull/700',
        title: 'CI: keep strings quoted\nwith context',
      },
    ],
    recordedAt: '2026-07-22T10:21:30Z',
  }
}

function shiftFixtureHours(input, hours) {
  const shifted = structuredClone(input)
  const shift = (value) => new Date(Date.parse(value) + hours * 60 * 60 * 1000).toISOString()
  for (const field of ['created_at', 'run_started_at', 'updated_at']) {
    shifted.run[field] = shift(shifted.run[field])
  }
  for (const job of shifted.jobs) {
    job.started_at = shift(job.started_at)
    job.completed_at = shift(job.completed_at)
    for (const step of job.steps) {
      step.started_at = shift(step.started_at)
      step.completed_at = shift(step.completed_at)
    }
  }
  shifted.recordedAt = shift(shifted.recordedAt)
  return shifted
}

test('builds stable Main timing metrics from completed run jobs and steps', () => {
  const record = buildMainBuildStats(fixture())

  assert.deepEqual(record.summary, {
    queue_seconds: 120,
    execution_seconds: 1080,
    wall_seconds: 1200,
    job_count: 1,
    step_count: 4,
    build_seconds: 600,
    deployment_seconds: 120,
    coverage_seconds: 30,
  })
  assert.equal(record.source_run.completed_at, '2026-07-22T10:20:00Z')
  assert.equal(record.jobs[0].duration_seconds, 1080)
  assert.equal(record.source_pull_requests[0].title, 'CI: keep strings quoted\nwith context')
})

test('serializes JSON-compatible YAML without unsafe plain scalars', () => {
  const serialized = serializeMainBuildStats(buildMainBuildStats(fixture()))
  const parsed = JSON.parse(serialized)

  assert.equal(parsed.source_run.run_id, 123456)
  assert.match(serialized, /"title": "CI: keep strings quoted\\nwith context"/)
  assert.ok(serialized.endsWith('\n'))
})

test('records persistent compiler and BuildKit cache telemetry from Main artifacts', () => {
  const input = fixture()
  input.cacheTelemetry = [
    {
      schema_version: 1,
      github: {
        run_id: String(input.run.id),
        run_attempt: input.run.run_attempt,
        job: 'ci',
      },
      cache_backend: {
        kind: 'remote',
        persistent: true,
        reason: 'persistent_service',
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
        measurement: 'buildx_target_record_steps',
      },
      collection: { complete: true, warnings: [] },
    },
  ]

  const record = buildMainBuildStats(input)

  assert.equal(record.schema_version, 2)
  assert.equal(record.cache_telemetry.jobs[0].cache_backend.kind, 'remote')
  assert.equal(record.cache_telemetry.totals.sccache_hit_rate_percent, 80)
  assert.equal(record.cache_telemetry.totals.buildkit_cache_hit_rate_percent, 70)
  assert.equal(record.cache_telemetry.collection.complete, true)
})

test('marks cache telemetry unavailable instead of inventing hit rates', () => {
  const record = buildMainBuildStats(fixture())

  assert.equal(record.cache_telemetry.totals.job_count, 0)
  assert.equal(record.cache_telemetry.totals.sccache_hit_rate_percent, null)
  assert.equal(record.cache_telemetry.totals.buildkit_cache_hit_rate_percent, null)
  assert.deepEqual(record.cache_telemetry.collection.warnings, [
    'cache_telemetry_artifact_unavailable',
  ])
})

test('normalizes legacy schema-2 direct-compile telemetry', () => {
  const record = buildMainBuildStats(fixture())
  record.cache_telemetry.totals.local_fallback_job_count =
    record.cache_telemetry.totals.direct_compile_job_count
  delete record.cache_telemetry.totals.direct_compile_job_count
  record.cache_telemetry.jobs = [
    {
      job: 'ci',
      cache_backend: {
        kind: 'local_fallback',
        persistent: false,
        reason: 'credentials_unavailable',
      },
      sccache: {
        report_count: 0,
        compile_requests: 0,
        requests_executed: 0,
        cache_hits: 0,
        cache_misses: 0,
        cache_errors: 0,
        cache_writes: 0,
        hit_rate_percent: null,
      },
      buildkit: {
        build_record_count: 0,
        completed_steps: 0,
        cached_steps: 0,
        cache_hit_rate_percent: null,
        measurement: 'buildx_target_record_steps',
      },
      collection: { complete: true, warnings: [] },
    },
  ]
  record.cache_telemetry.totals.job_count = 1
  record.cache_telemetry.totals.local_fallback_job_count = 1

  const normalized = normalizeLegacyMainBuildStats(record)

  assert.equal(normalized.cache_telemetry.totals.direct_compile_job_count, 1)
  assert.equal(normalized.cache_telemetry.totals.local_fallback_job_count, undefined)
  assert.equal(normalized.cache_telemetry.jobs[0].cache_backend.kind, 'direct_compile')
  validateMainBuildStats(normalized)
})

test('retains incomplete failed steps with null timing instead of inventing duration', () => {
  const input = fixture()
  input.run.conclusion = 'cancelled'
  input.jobs[0].conclusion = 'cancelled'
  input.jobs[0].steps[1].conclusion = 'cancelled'
  input.jobs[0].steps[1].completed_at = null

  const record = buildMainBuildStats(input)

  assert.equal(record.source_run.conclusion, 'cancelled')
  assert.equal(record.jobs[0].steps[1].duration_seconds, null)
  assert.equal(record.summary.build_seconds, null)
  assert.equal(record.comparison.baseline_quality, 'not_applicable')
})

test('uses attempt-specific start and job timestamps for rerun wall time', () => {
  const input = fixture()
  input.run.run_attempt = 2
  input.run.created_at = '2026-07-21T10:00:00Z'
  input.run.run_started_at = '2026-07-22T10:01:00Z'

  const record = buildMainBuildStats(input)

  assert.equal(record.source_run.started_at, '2026-07-22T10:02:00Z')
  assert.equal(record.summary.queue_seconds, 60)
  assert.equal(record.summary.execution_seconds, 1080)
  assert.equal(record.summary.wall_seconds, 1140)
})

test('flags successful build regressions against the two latest successful attempts', () => {
  const firstInput = shiftFixtureHours(fixture(), -2)
  firstInput.run.id = 100001
  const first = buildMainBuildStats(firstInput)
  const secondInput = shiftFixtureHours(fixture(), -1)
  secondInput.run.id = 100002
  const second = buildMainBuildStats(secondInput)
  const currentInput = fixture()
  currentInput.run.id = 100003
  currentInput.jobs[0].completed_at = '2026-07-22T10:26:00Z'
  currentInput.jobs[0].steps[1].completed_at = '2026-07-22T10:17:00Z'
  currentInput.jobs[0].steps[2].started_at = '2026-07-22T10:17:00Z'
  currentInput.jobs[0].steps[2].completed_at = '2026-07-22T10:19:00Z'

  const current = buildMainBuildStats({
    ...currentInput,
    baselineRecords: [first, second],
  })

  assert.equal(current.comparison.baseline_quality, 'comparable')
  assert.equal(current.comparison.regression, true)
  assert.deepEqual(current.comparison.baseline_runs, [
    { run_id: 100002, run_attempt: 1 },
    { run_id: 100001, run_attempt: 1 },
  ])
  assert.ok(current.comparison.execution_seconds_change_percent > 20)
  assert.ok(current.comparison.build_seconds_change_percent > 20)
})

test('does not use delayed collector records from the future as baselines', () => {
  const earlierInput = shiftFixtureHours(fixture(), -1)
  earlierInput.run.id = 100001
  const earlier = buildMainBuildStats(earlierInput)
  const futureInput = shiftFixtureHours(fixture(), 1)
  futureInput.run.id = 100003
  const future = buildMainBuildStats(futureInput)
  const currentInput = fixture()
  currentInput.run.id = 100002

  const current = buildMainBuildStats({
    ...currentInput,
    baselineRecords: [future, earlier],
  })

  assert.deepEqual(current.comparison.baseline_runs, [{ run_id: 100001, run_attempt: 1 }])
  assert.equal(current.comparison.baseline_quality, 'weak')
})

test('rejects records whose summary cannot be derived from detailed jobs', () => {
  const record = buildMainBuildStats(fixture())
  record.summary.step_count += 1

  assert.throws(() => validateMainBuildStats(record), /summary\.step_count mismatch/)
})

test('workflow records completed trusted Main runs without a stats recursion path', () => {
  const root = path.join(__dirname, '..', '..')
  const collector = fs.readFileSync(
    path.join(root, '.github/workflows/main-build-stats.yml'),
    'utf8',
  )
  const main = fs.readFileSync(path.join(root, '.github/workflows/main.yml'), 'utf8')
  const pullRequest = fs.readFileSync(path.join(root, '.github/workflows/pr.yml'), 'utf8')

  assert.match(collector, /workflow_run:\n\s+workflows: \[Main\]\n\s+types: \[completed\]\n\s+branches: \[main\]/)
  assert.match(collector, /github\.event\.workflow_run\.event == 'push'/)
  assert.match(collector, /github\.event\.workflow_run\.head_branch == 'main'/)
  assert.match(collector, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/)
  assert.match(
    collector,
    /runs\/\{run_id\}\/attempts\/\{attempt_number\}'[\s\S]*attempt_number: eventRun\.run_attempt/,
  )
  assert.match(
    collector,
    /runs\/\{run_id\}\/attempts\/\{attempt_number\}\/jobs'[\s\S]*attempt_number: eventRun\.run_attempt/,
  )
  assert.match(collector, /cache-telemetry-\$\{\{ github\.event\.workflow_run\.id \}\}/)
  assert.match(collector, /run-id: \$\{\{ github\.event\.workflow_run\.id \}\}/)
  assert.match(collector, /github-token: \$\{\{ github\.token \}\}/)
  assert.doesNotMatch(collector, /filter: 'latest'/)
  assert.match(collector, /GH_TOKEN: \$\{\{ secrets\.NOOK_GITHUB_PAT \}\}/)
  assert.doesNotMatch(collector, /GH_TOKEN:.*github\.token/)
  assert.match(collector, /NOOK_GITHUB_PAT is required to admin-merge/)
  assert.match(collector, /\.stats\/main-build\/\$\{run\.id\}-attempt-\$\{run\.run_attempt\}\.yaml/)
  assert.match(main, /paths-ignore:[\s\S]*- \.stats\/\*\*/)
  assert.match(pullRequest, /paths-ignore:[\s\S]*- \.stats\/\*\*/)
})
