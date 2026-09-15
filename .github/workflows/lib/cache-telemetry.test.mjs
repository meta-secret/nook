import assert from "node:assert/strict";
import test from "node:test";

import {
  BuildkitCacheExportTelemetry,
  CacheScopeTelemetry,
  CacheTelemetry,
} from "./cache-telemetry.mjs";

void test("records ordinary compile publication boundaries", () => {
  assert.deepEqual(
    new CacheScopeTelemetry({
      GHA_CACHE_WRITE_ENABLED: "1",
      GHA_CACHE_ENABLED: "1",
      NOOK_COMPILE_CACHE_MODE: "publish",
      GHA_CACHE_EXACT_BUILD_COMPILE_AVAILABLE: "1",
      GHA_CACHE_SCOPE_SUFFIX: `-git-${"b".repeat(40)}`,
      GHA_BUILD_COMPILE_RESTORE_SCOPE_SUFFIX: `-git-${"c".repeat(40)}`,
      GHA_CACHE_RESTORE_RUST_NATIVE_SCOPE_SUFFIX: `-git-${"d".repeat(40)}`,
      NOOK_COMPILER_INPUT_FINGERPRINT: "compiler-input-current",
      NOOK_RESTORE_COMPILER_INPUT_FINGERPRINT: "compiler-input-parent",
    }).record(),
    {
      scope: `exact-git-${"b".repeat(40)}`,
      compile_dependencies: {
        scope: "",
        available: false,
        write_enabled: false,
        export_enabled: false,
      },
      compile_source: {
        scope: `nook-build-compile-v4-git-${"b".repeat(40)}`,
        restore_scope: `nook-build-compile-v4-git-${"c".repeat(40)}`,
        available: true,
        write_enabled: false,
        export_enabled: false,
      },
      compiler_input: {
        fingerprint: "compiler-input-current",
        restore_fingerprint: "compiler-input-parent",
      },
      imports: {
        probes_complete: false,
        failure_class: "none",
        availability: [
          {
            name: "GHA_CACHE_EXACT_BUILD_COMPILE_AVAILABLE",
            available: true,
          },
        ],
        restore_suffixes: [
          {
            name: "GHA_CACHE_RESTORE_RUST_NATIVE_SCOPE_SUFFIX",
            suffix: `-git-${"d".repeat(40)}`,
          },
        ],
      },
    },
  );
});

void test("distinguishes exact, Main, and local-only BuildKit scope selection", () => {
  assert.equal(
    new CacheScopeTelemetry({
      GHA_CACHE_ENABLED: "1",
      GHA_CACHE_SCOPE_SUFFIX: `-git-${"a".repeat(40)}`,
    }).record().scope,
    `exact-git-${"a".repeat(40)}`,
  );
  assert.equal(
    new CacheScopeTelemetry({ GHA_CACHE_ENABLED: "1" }).record().scope,
    "main",
  );
  assert.equal(new CacheScopeTelemetry({}).record().scope, "local-only");
});

void test("records transient optional probe failures without marking probes incomplete", () => {
  const scope = new CacheScopeTelemetry({
    GHA_CACHE_EXACT_PROBES_COMPLETE: "1",
    GHA_CACHE_EXACT_PROBE_FAILURE_CLASS: "transient_unavailable",
    GHA_CACHE_EXACT_BUILD_COMPILE_AVAILABLE: "",
  }).record();

  assert.equal(scope.imports.probes_complete, true);
  assert.equal(scope.imports.failure_class, "transient_unavailable");
  assert.equal(scope.compile_dependencies.available, false);
  assert.equal(scope.compile_source.available, false);
});

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
    failures: [
      {
        component: "collector",
        reference: "cache-telemetry",
        message: "collection_timeout:30s",
      },
    ],
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

void test("selects cancelled Buildx records so completed stage telemetry survives", () => {
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
    ["still-running", "newer", "same-a"],
  );
  assert.deepEqual(selection.warnings, [
    "buildx_records_unfinished_included:1",
    "buildx_records_truncated:3/5",
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
  assert.match(
    CacheTelemetry.readHistoryEvents.toString(),
    /events\.length > 0 \|\| \(status === 0/,
  );
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
    cache_export: {
      attempts: 0,
      completed: 0,
      bytes: 0,
      duration_ms: 0,
      incomplete_failures: 0,
    },
    measurement: "buildx_target_record_steps",
  });
  const firstRecord = records.at(0);
  const secondRecord = records.at(1);
  assert.ok(firstRecord);
  assert.ok(secondRecord);
  assert.equal(firstRecord.cache_hit_rate_percent, 75);
  assert.equal(secondRecord.status, "error");
});

void test("extracts structured registry cache bytes, timings, and incomplete failures", () => {
  const summary = new BuildkitCacheExportTelemetry([
    {
      vertexes: [
        {
          digest: "sha256:complete",
          name: "exporting cache to registry",
          started: "2026-09-13T01:00:00Z",
          completed: "2026-09-13T01:00:03.250Z",
        },
        {
          digest: "sha256:failed",
          name: "exporting cache to registry",
          started: "2026-09-13T01:00:04Z",
          error: "rpc error: code = Unavailable",
        },
      ],
      statuses: [
        {
          vertex: "sha256:complete-transfer",
          id: "push",
          name: "pushing cache manifest",
          current: 0,
          total: 4096,
        },
        {
          vertex: "sha256:failed-transfer",
          id: "push",
          name: "pushing layers",
          current: 1024,
          total: 8192,
        },
      ],
    },
  ]).summary();

  assert.deepEqual(summary, {
    attempts: 2,
    completed: 1,
    bytes: 5120,
    duration_ms: 3250,
    incomplete_failures: 1,
  });
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

void test("aggregates publish reports with effective READ_WRITE authority", () => {
  const first = {
    stage: "native-clippy",
    baked_runtime_mode: "READ_WRITE",
    runtime_mode: "READ_WRITE",
    runtime_mode_source: "runtime_secret",
    client_side: true,
    counter_reliability: "backend_incomplete",
    publication_status: "counters_observed",
    compile_requests: 12,
    requests_executed: 10,
    cache_hits: 8,
    cache_misses: 2,
    cache_errors: 0,
    cache_write_errors: 0,
    cache_writes: 2,
  };
  const second = {
    stage: "wasm-build",
    baked_runtime_mode: "READ_WRITE",
    runtime_mode: "READ_WRITE",
    runtime_mode_source: "runtime_secret",
    client_side: true,
    counter_reliability: "backend_incomplete",
    publication_status: "counters_observed",
    compile_requests: 6,
    requests_executed: 5,
    cache_hits: 3,
    cache_misses: 2,
    cache_errors: 0,
    cache_write_errors: 0,
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
    baked_runtime_mode: "READ_WRITE",
    runtime_mode: "READ_WRITE",
    runtime_mode_source: "runtime_secret",
    client_side: true,
    counter_reliability: "backend_incomplete",
    publication_status: "counters_observed",
    compile_requests: 18,
    requests_executed: 15,
    cache_hits: 11,
    cache_misses: 4,
    cache_errors: 0,
    cache_write_errors: 0,
    cache_writes: 4,
    compile_failures: 0,
    measurement: "sum_of_zero_based_run_snapshots",
    fallback: { state: "active", reason: "none" },
    snapshots: reports,
    hit_rate_percent: 73.33,
  });
});

void test("extracts zero-based sccache snapshots from a cancelled raw build log", () => {
  const raw =
    'step NOOK_SCCACHE_STATS {"stage":"native","baked_runtime_mode":"READ_WRITE","runtime_mode":"READ_WRITE","runtime_mode_source":"runtime_secret","client_side":true,"counter_reliability":"backend_incomplete","publication_status":"counters_observed","compile_requests":12,"requests_executed":10,"cache_hits":8,"cache_misses":2,"cache_errors":0,"cache_write_errors":0,"cache_writes":2,"compile_failures":0}\ncancelled\n';
  const reports = CacheTelemetry.extractSccacheReportsFromText(raw);
  assert.equal(reports.length, 1);
  assert.deepEqual(reports.map((report) => report.cache_hits), [8]);
});

void test("marks client-side zero-write publication counters pending verification", () => {
  const report = CacheTelemetry.normalizeSccacheReport({
    stage: "compile-native",
    baked_runtime_mode: "READ_WRITE",
    runtime_mode: "READ_WRITE",
    runtime_mode_source: "runtime_secret",
    client_side: true,
    counter_reliability: "backend_incomplete",
    publication_status: "pending_verification",
    compile_requests: 0,
    requests_executed: 279,
    cache_hits: 0,
    cache_misses: 275,
    cache_errors: 0,
    cache_write_errors: 0,
    cache_writes: 0,
  });

  const summary = CacheTelemetry.summarizeSccache([report]);
  assert.equal(summary.counter_reliability, "backend_incomplete");
  assert.equal(summary.publication_status, "pending_verification");
  assert.equal(summary.requests_executed, 279);
});

void test("reports the selected persistent or no-secret fallback backend", () => {
  const fallbackEvents = [
    {
      logs: [
        {
          data: Buffer.from(
            'NOOK_SCCACHE_FALLBACK {"backend":"direct_compile","reason":"cache_transport_unavailable","remote_writes":0}\n',
          ).toString("base64"),
        },
      ],
    },
  ];
  assert.deepEqual(CacheTelemetry.extractSccacheFallback(fallbackEvents), {
    state: "fallback",
    reason: "cache_transport_unavailable",
  });
  assert.deepEqual(
    CacheTelemetry.cacheBackendFromEnvironment({
      NOOK_SCCACHE_BACKEND: "remote",
      NOOK_SCCACHE_BACKEND_REASON: "persistent_service",
      SCCACHE_S3_RW_MODE: "READ_WRITE",
    }),
    {
      kind: "remote",
      persistent: true,
      reason: "persistent_service",
    },
  );
  assert.deepEqual(CacheTelemetry.cacheBackendFromEnvironment({}), {
    kind: "direct_compile",
    persistent: false,
    reason: "credentials_unavailable",
  });
});

void test("a healthy terminal snapshot supersedes an earlier vertex fallback", () => {
  const text = [
    'NOOK_SCCACHE_FALLBACK {"backend":"direct_compile","reason":"cache_circuit_open","remote_writes":0}',
    'NOOK_SCCACHE_STATS {"stage":"compile-wasm","baked_runtime_mode":"READ_WRITE","runtime_mode":"READ_WRITE","runtime_mode_source":"runtime_secret","client_side":true,"counter_reliability":"backend_incomplete","publication_status":"counters_observed","compile_requests":602,"requests_executed":602,"cache_hits":592,"cache_misses":0,"cache_errors":0,"cache_write_errors":0,"cache_writes":0,"compile_failures":0}',
  ].join("\n");

  assert.deepEqual(CacheTelemetry.extractSccacheFallbackFromText(text), {
    state: "active",
    reason: "none",
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

void test("rejects an unknown sccache fallback state", () => {
  const record = CacheTelemetry.buildUnavailableTelemetry({
    warning: "fixture",
    job: "compile",
    runId: "1",
    runAttempt: "1",
  });
  assert.throws(
    () => CacheTelemetry.validateTelemetryRecord({
      ...record,
      sccache: {
        ...record.sccache,
        fallback: { state: "unknown", reason: "fixture" },
      },
    }),
    /telemetry sccache.fallback is invalid/,
  );
});
