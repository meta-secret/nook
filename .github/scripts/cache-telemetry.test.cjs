const assert = require('node:assert/strict')
const test = require('node:test')

const {
  cacheBackendFromEnvironment,
  extractSccacheReports,
  historyLogRef,
  normalizeBuildRecord,
  parseJsonObjects,
  parseRawJsonProgress,
  summarizeBuildkit,
  summarizeSccache,
} = require('./cache-telemetry.cjs')

test('uses the trailing build ID for Buildx history log lookup', () => {
  assert.equal(
    historyLogRef('desktop-linux/desktop-linux/xeiy59tjr9khjv8n8iqfhtscp'),
    'xeiy59tjr9khjv8n8iqfhtscp',
  )
  assert.equal(historyLogRef('plain-ref'), 'plain-ref')
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
