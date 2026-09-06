const assert = require('node:assert/strict')
const test = require('node:test')

const {
  buildUnavailableTelemetry,
  cacheBackendFromEnvironment,
  extractSccacheReports,
  historyLogRef,
  mapWithConcurrency,
  normalizeBuildRecord,
  parseJsonObjects,
  parseRawJsonProgress,
  selectBuildRecords,
  summarizeBuildkit,
  summarizeSccache,
  validateTelemetryRecord,
} = require('./cache-telemetry.cjs')

test('preserves a valid incomplete record when collection is unavailable', () => {
  const record = buildUnavailableTelemetry({
    warning: 'collection_timeout:30s',
    job: 'wasm-node-test',
    runId: '34018947778',
    runAttempt: '1',
    environment: {
      NOOK_SCCACHE_BACKEND: 'remote',
      NOOK_SCCACHE_BACKEND_REASON: 'persistent_service',
    },
  })

  validateTelemetryRecord(record, { runId: '34018947778', runAttempt: 1 })
  assert.deepEqual(record.collection, {
    complete: false,
    warnings: ['collection_timeout:30s'],
  })
  assert.equal(record.github.job, 'wasm-node-test')
  assert.equal(record.cache_backend.kind, 'remote')
})

test('uses the trailing build ID for Buildx history log lookup', () => {
  assert.equal(
    historyLogRef('desktop-linux/desktop-linux/xeiy59tjr9khjv8n8iqfhtscp'),
    'xeiy59tjr9khjv8n8iqfhtscp',
  )
  assert.equal(historyLogRef('plain-ref'), 'plain-ref')
})

test('selects a deterministic bounded set of finalized Buildx records', () => {
  const record = (ref, completedAt, startedAt = completedAt) => ({
    ref,
    completed_at: completedAt,
    started_at: startedAt,
  })
  const selection = selectBuildRecords(
    [
      record('older', '2026-09-06T01:00:00Z'),
      record('same-b', '2026-09-06T03:00:00Z', '2026-09-06T02:00:00Z'),
      record('same-a', '2026-09-06T03:00:00Z', '2026-09-06T02:00:00Z'),
      record('newer', '2026-09-06T04:00:00Z'),
      { ref: 'still-running', started_at: '2026-09-06T05:00:00Z' },
    ],
    3,
  )

  assert.deepEqual(
    selection.records.map(({ ref }) => ref),
    ['newer', 'same-a', 'same-b'],
  )
  assert.deepEqual(selection.warnings, [
    'buildx_records_unfinished_skipped:1',
    'buildx_records_truncated:3/4',
  ])
})

test('maps history logs concurrently while preserving record order', async () => {
  let active = 0
  let maximumActive = 0
  const results = await mapWithConcurrency([0, 1, 2, 3, 4, 5], 3, async (value) => {
    active += 1
    maximumActive = Math.max(maximumActive, active)
    await new Promise((resolve) => setImmediate(resolve))
    active -= 1
    return value * 2
  })

  assert.equal(maximumActive, 3)
  assert.deepEqual(results, [0, 2, 4, 6, 8, 10])
})

test('accepts raw Buildx progress JSON from either process stream', () => {
  assert.deepEqual(
    parseRawJsonProgress(
      '{"vertexes":[]}\nnot-json\n{"logs":[{"vertex":"one","data":"eAo="}]}',
    ),
    {
      objects: [
        { vertexes: [] },
        { logs: [{ vertex: 'one', data: 'eAo=' }] },
      ],
      diagnostics: ['not-json'],
    },
  )
})

test('normalizes Buildx history output and computes the target-step cache rate', () => {
  const records = parseJsonObjects(
    [
      '{"ref":"one","name":"rust","status":"Completed","completed_steps":20,"total_steps":20,"cached_steps":15}',
      '{"ref":"two","name":"web","status":"Error","completed_steps":5,"total_steps":9,"cached_steps":2}',
    ].join('\n'),
  ).map(normalizeBuildRecord)

  assert.deepEqual(summarizeBuildkit(records), {
    build_record_count: 2,
    completed_steps: 25,
    cached_steps: 17,
    cache_hit_rate_percent: 68,
    measurement: 'buildx_target_record_steps',
  })
  assert.equal(records[0].cache_hit_rate_percent, 75)
  assert.equal(records[1].status, 'error')
})

test('accepts the documented Buildx JSON array and PascalCase fields', () => {
  const [record] = parseJsonObjects(
    JSON.stringify([
      {
        Ref: 'abc',
        Name: 'example',
        Status: 'Completed',
        NumCompletedSteps: 16,
        NumTotalSteps: 16,
        NumCachedSteps: 4,
      },
    ]),
  ).map(normalizeBuildRecord)

  assert.equal(record.ref, 'abc')
  assert.equal(record.cache_hit_rate_percent, 25)
})

test('deduplicates shared Buildx log markers and aggregates sccache hit rate', () => {
  const first = {
    stage: 'native-clippy',
    compile_requests: 12,
    requests_executed: 10,
    cache_hits: 8,
    cache_misses: 2,
    cache_errors: 0,
    cache_writes: 2,
  }
  const second = {
    stage: 'wasm-build',
    compile_requests: 6,
    requests_executed: 5,
    cache_hits: 3,
    cache_misses: 2,
    cache_errors: 0,
    cache_writes: 2,
  }
  const log = (payload, vertex, timestamp) => ({
    vertex,
    timestamp,
    data: Buffer.from(`NOOK_SCCACHE_STATS ${JSON.stringify(payload)}\n`).toString('base64'),
  })
  const reports = extractSccacheReports([
    { logs: [log(first, 'sha256:first', '2026-07-23T01:00:00Z')] },
    { logs: [log(first, 'sha256:first', '2026-07-23T01:00:00Z')] },
    { logs: [log(second, 'sha256:second', '2026-07-23T01:00:01Z')] },
  ])

  assert.equal(reports.length, 2)
  assert.deepEqual(summarizeSccache(reports), {
    report_count: 2,
    compile_requests: 18,
    requests_executed: 15,
    cache_hits: 11,
    cache_misses: 4,
    cache_errors: 0,
    cache_writes: 4,
    hit_rate_percent: 73.33,
  })
})

test('reports the selected persistent or fallback Redis backend without credentials', () => {
  assert.deepEqual(
    cacheBackendFromEnvironment({
      NOOK_SCCACHE_BACKEND: 'remote',
      NOOK_SCCACHE_BACKEND_REASON: 'persistent_service',
    }),
    { kind: 'remote', persistent: true, reason: 'persistent_service' },
  )
  assert.deepEqual(cacheBackendFromEnvironment({}), {
    kind: 'direct_compile',
    persistent: false,
    reason: 'credentials_unavailable',
  })
})
