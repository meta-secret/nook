import assert from "node:assert/strict";
import test from "node:test";

import { CacheTelemetry } from "./cache-telemetry.mjs";

void test("preserves a valid incomplete record when collection is unavailable", () => {
  const record = CacheTelemetry.buildUnavailableTelemetry({
    warning: "collection_timeout:30s",
    job: "wasm-node-test",
    runId: "34018947778",
    runAttempt: "1",
    environment: {
      NOOK_SCCACHE_BACKEND: "remote",
      NOOK_SCCACHE_BACKEND_REASON: "persistent_service",
    },
  });

  CacheTelemetry.validateTelemetryRecord(record, {
    runId: "34018947778",
    runAttempt: 1,
  });
  assert.deepEqual(record.collection, {
    complete: false,
    warnings: ["collection_timeout:30s"],
  });
  assert.equal(record.github.job, "wasm-node-test");
  assert.equal(record.cache_backend.kind, "remote");
});

void test("uses the trailing build ID for Buildx history log lookup", () => {
  assert.equal(
    CacheTelemetry.historyLogRef(
      "desktop-linux/desktop-linux/xeiy59tjr9khjv8n8iqfhtscp",
    ),
    "xeiy59tjr9khjv8n8iqfhtscp",
  );
  assert.equal(CacheTelemetry.historyLogRef("plain-ref"), "plain-ref");
});

void test("selects a deterministic bounded set of finalized Buildx records", () => {
  /**
   * @param {string} ref
   * @param {string} completedAt
   * @param {string} [startedAt]
   */
  const record = (ref, completedAt, startedAt = completedAt) => ({
    ref,
    name: ref,
    status: "completed",
    completed_at: completedAt,
    started_at: startedAt,
    completed_steps: 1,
    total_steps: 1,
    cached_steps: 0,
  });
  const selection = CacheTelemetry.selectBuildRecords(
    [
      record("older", "2026-09-06T01:00:00Z"),
      record("same-b", "2026-09-06T03:00:00Z", "2026-09-06T02:00:00Z"),
      record("same-a", "2026-09-06T03:00:00Z", "2026-09-06T02:00:00Z"),
      record("newer", "2026-09-06T04:00:00Z"),
      {
        ref: "still-running",
        name: "still-running",
        status: "running",
        started_at: "2026-09-06T05:00:00Z",
        completed_steps: 0,
        total_steps: 1,
        cached_steps: 0,
      },
    ],
    3,
  );

  assert.deepEqual(
    selection.records.map(({ ref }) => ref),
    ["newer", "same-a", "same-b"],
  );
  assert.deepEqual(selection.warnings, [
    "buildx_records_unfinished_skipped:1",
    "buildx_records_truncated:3/4",
  ]);
});

void test("maps history logs concurrently while preserving record order", async () => {
  let active = 0;
  let maximumActive = 0;
  const results = await CacheTelemetry.mapWithConcurrency(
    [0, 1, 2, 3, 4, 5],
    3,
    async (value) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return value * 2;
    },
  );

  assert.equal(maximumActive, 3);
  assert.deepEqual(results, [0, 2, 4, 6, 8, 10]);
});

void test("accepts raw Buildx progress JSON from either process stream", () => {
  assert.deepEqual(
    CacheTelemetry.parseRawJsonProgress(
      '{"vertexes":[]}\nnot-json\n{"logs":[{"vertex":"one","data":"eAo="}]}',
    ),
    {
      objects: [{ vertexes: [] }, { logs: [{ vertex: "one", data: "eAo=" }] }],
      diagnostics: ["not-json"],
    },
  );
});

void test("rejects non-record Buildx history JSON at the ingress", () => {
  assert.throws(
    () => CacheTelemetry.parseJsonObjects('[{"ref":"accepted"},42]'),
    /expected a JSON object array/,
  );
  assert.deepEqual(CacheTelemetry.parseRawJsonProgress("42\n"), {
    objects: [],
    diagnostics: ["42"],
  });
});

void test("normalizes Buildx history output and computes the target-step cache rate", () => {
  const records = CacheTelemetry.parseJsonObjects(
    [
      '{"ref":"one","name":"rust","status":"Completed","completed_steps":20,"total_steps":20,"cached_steps":15}',
      '{"ref":"two","name":"web","status":"Error","completed_steps":5,"total_steps":9,"cached_steps":2}',
    ].join("\n"),
  ).map((record) => CacheTelemetry.normalizeBuildRecord(record));

  assert.deepEqual(CacheTelemetry.summarizeBuildkit(records), {
    build_record_count: 2,
    completed_steps: 25,
    cached_steps: 17,
    cache_hit_rate_percent: 68,
    measurement: "buildx_target_record_steps",
  });
  const firstRecord = records.at(0);
  const secondRecord = records.at(1);
  assert.ok(firstRecord);
  assert.ok(secondRecord);
  assert.equal(firstRecord.cache_hit_rate_percent, 75);
  assert.equal(secondRecord.status, "error");
});

void test("accepts the documented Buildx JSON array and PascalCase fields", () => {
  const record = CacheTelemetry.parseJsonObjects(
    JSON.stringify([
      {
        Ref: "abc",
        Name: "example",
        Status: "Completed",
        NumCompletedSteps: 16,
        NumTotalSteps: 16,
        NumCachedSteps: 4,
      },
    ]),
  )
    .map((candidate) => CacheTelemetry.normalizeBuildRecord(candidate))
    .at(0);

  assert.ok(record);
  assert.equal(record.ref, "abc");
  assert.equal(record.cache_hit_rate_percent, 25);
});

void test("deduplicates shared Buildx log markers and aggregates sccache hit rate", () => {
  const first = {
    stage: "native-clippy",
    compile_requests: 12,
    requests_executed: 10,
    cache_hits: 8,
    cache_misses: 2,
    cache_errors: 0,
    cache_writes: 2,
  };
  const second = {
    stage: "wasm-build",
    compile_requests: 6,
    requests_executed: 5,
    cache_hits: 3,
    cache_misses: 2,
    cache_errors: 0,
    cache_writes: 2,
  };
  /** @param {object} payload @param {string} vertex @param {string} timestamp */
  const log = (payload, vertex, timestamp) => ({
    vertex,
    timestamp,
    data: Buffer.from(
      `NOOK_SCCACHE_STATS ${JSON.stringify(payload)}\n`,
    ).toString("base64"),
  });
  const reports = CacheTelemetry.extractSccacheReports([
    { logs: [log(first, "sha256:first", "2026-07-23T01:00:00Z")] },
    { logs: [log(first, "sha256:first", "2026-07-23T01:00:00Z")] },
    { logs: [log(second, "sha256:second", "2026-07-23T01:00:01Z")] },
  ]);

  assert.equal(reports.length, 2);
  assert.deepEqual(CacheTelemetry.summarizeSccache(reports), {
    report_count: 2,
    compile_requests: 18,
    requests_executed: 15,
    cache_hits: 11,
    cache_misses: 4,
    cache_errors: 0,
    cache_writes: 4,
    hit_rate_percent: 73.33,
  });
});

void test("reports the selected persistent or fallback Redis backend without credentials", () => {
  assert.deepEqual(
    CacheTelemetry.cacheBackendFromEnvironment({
      NOOK_SCCACHE_BACKEND: "remote",
      NOOK_SCCACHE_BACKEND_REASON: "persistent_service",
    }),
    { kind: "remote", persistent: true, reason: "persistent_service" },
  );
  assert.deepEqual(CacheTelemetry.cacheBackendFromEnvironment({}), {
    kind: "direct_compile",
    persistent: false,
    reason: "credentials_unavailable",
  });
});

void test("rejects malformed nested telemetry records at the ingress", () => {
  assert.throws(
    () =>
      CacheTelemetry.validateTelemetryRecord({
        schema_version: 1,
        github: "invalid",
      }),
    /telemetry github context is required/,
  );
});
