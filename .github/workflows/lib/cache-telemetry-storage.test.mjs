import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { CacheTelemetry } from "./cache-telemetry.mjs";
import { CacheTelemetryValidator } from "./cache-telemetry-validator.mjs";
import { PrCacheHealth } from "./pr-cache-health.mjs";
import { resolveSccacheFallback } from "./cache-telemetry-fallback.mjs";

/** @typedef {import("./cache-telemetry-contracts.mjs").SccacheReport} SccacheReport */
/** @typedef {{state: 'active' | 'fallback', reason: string}} FallbackState */

void test("reporter preserves native storage counters and finalizes compiler snapshots", () => {
  const result = spawnSync(
    "bash",
    [".github/scripts/sccache-publication.test.sh"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(
    result.stdout,
    /native counters, isolated snapshots, and health semantics verified/,
  );
});

void test("requires complete measured storage counters and preserves local reuse", () => {
  const validator = new CacheTelemetryValidator();
  const measured = {
    local_hits: 4,
    remote_hits: 1,
    local_writes: 2,
    local_write_errors: 0,
    remote_write_errors: 0,
    local_backfills: 1,
  };
  validator.validateSccacheStorageCounters(measured);
  const { local_backfills: omittedBackfills, ...partial } = measured;
  void omittedBackfills;
  assert.throws(
    () => validator.validateSccacheStorageCounters(partial),
    /local_backfills/,
  );
  assert.throws(
    () => validator.validateSccacheStorageCounters({ ...measured, local_hits: -1 }),
    /local_hits/,
  );
  assert.throws(
    () => validator.validateSccacheStorageCounters({}),
    /local_hits/,
  );
  const record = CacheTelemetry.buildUnavailableTelemetry({
    warning: "fixture",
    job: "storage",
  });
  assert.equal(record.schema_version, 3);
  assert.equal(record.sccache.counter_reliability, "unavailable");
  assert.equal(record.sccache.report_count, 0);
  assert.throws(
    () => CacheTelemetry.validateTelemetryRecord({ ...record, schema_version: 2 }),
    /schema_version must be 3/,
  );
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
    remote_writes: 2,
    local_hits: 4,
    remote_hits: 4,
    local_writes: 2,
    local_write_errors: 0,
    remote_write_errors: 0,
    local_backfills: 0,
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
    remote_writes: 2,
    local_hits: 2,
    remote_hits: 1,
    local_writes: 2,
    local_write_errors: 0,
    remote_write_errors: 0,
    local_backfills: 0,
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
    remote_writes: 4,
    local_hits: 6,
    remote_hits: 5,
    local_writes: 4,
    local_write_errors: 0,
    remote_write_errors: 0,
    local_backfills: 0,
    compile_failures: 0,
    measurement: "sum_of_zero_based_run_snapshots",
    fallback: { state: "active", reason: "none" },
    snapshots: reports,
    hit_rate_percent: 73.33,
  });
});

void test("aggregates reports across equivalent runtime authority sources", () => {
  const environmentReport = {
    stage: "wasm-source",
    baked_runtime_mode: "READ_WRITE",
    runtime_mode: "READ_WRITE",
    runtime_mode_source: "environment",
    client_side: false,
    counter_reliability: "authoritative",
    publication_status: "counters_observed",
    compile_requests: 2,
    requests_executed: 2,
    cache_hits: 2,
    cache_misses: 0,
    cache_errors: 0,
    cache_write_errors: 0,
    cache_writes: 0,
    remote_writes: 0,
    local_hits: 0,
    remote_hits: 2,
    local_writes: 0,
    local_write_errors: 0,
    remote_write_errors: 0,
    local_backfills: 0,
    compile_failures: 0,
  };
  const runtimeSecretReport = {
    ...environmentReport,
    stage: "wasm-build",
    runtime_mode_source: "runtime_secret",
    client_side: true,
    counter_reliability: "backend_incomplete",
    compile_requests: 1,
    requests_executed: 1,
    cache_hits: 1,
  };

  const summary = CacheTelemetry.summarizeSccache([
    CacheTelemetry.normalizeSccacheReport(environmentReport),
    CacheTelemetry.normalizeSccacheReport(runtimeSecretReport),
  ]);

  assert.equal(summary.report_count, 2);
  assert.equal(summary.runtime_mode, "READ_WRITE");
  assert.equal(summary.runtime_mode_source, "runtime_secret");
  assert.equal(summary.client_side, true);
  assert.equal(summary.counter_reliability, "backend_incomplete");
  assert.equal(summary.compile_requests, 3);
  assert.equal(summary.cache_hits, 3);
});

void test("extracts zero-based sccache snapshots from a cancelled raw build log", () => {
  const raw =
    'step NOOK_SCCACHE_STATS {"stage":"native","baked_runtime_mode":"READ_WRITE","runtime_mode":"READ_WRITE","runtime_mode_source":"runtime_secret","client_side":true,"counter_reliability":"backend_incomplete","publication_status":"counters_observed","compile_requests":12,"requests_executed":10,"cache_hits":8,"cache_misses":2,"cache_errors":0,"cache_write_errors":0,"cache_writes":2,"remote_writes":2,"local_hits":0,"remote_hits":8,"local_writes":0,"local_write_errors":0,"remote_write_errors":0,"local_backfills":0,"compile_failures":0}\ncancelled\n';
  const reports = CacheTelemetry.extractSccacheReportsFromText(raw);
  assert.equal(reports.length, 1);
  const [report] = reports;
  assert.ok(report);
  assert.equal(report.cache_hits, 8);
});

void test("merges raw-log and BuildKit-history reports for distinct compiler stages", async () => {
  const originalListBuildHistory =
    CacheTelemetry.listBuildHistory.bind(CacheTelemetry);
  const originalReadHistoryEvents =
    CacheTelemetry.readHistoryEvents.bind(CacheTelemetry);
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "nook-cache-telemetry-"),
  );
  const report = {
    stage: "wasm-node-test-and-coverage",
    baked_runtime_mode: "READ_WRITE",
    runtime_mode: "READ_WRITE",
    runtime_mode_source: "runtime_secret",
    client_side: false,
    counter_reliability: "authoritative",
    publication_status: "counters_observed",
    compile_requests: 3,
    requests_executed: 3,
    cache_hits: 2,
    cache_misses: 1,
    cache_errors: 0,
    cache_write_errors: 0,
    cache_writes: 1,
    remote_writes: 1,
    local_hits: 0,
    remote_hits: 2,
    local_writes: 0,
    local_write_errors: 0,
    remote_write_errors: 0,
    local_backfills: 0,
    compile_failures: 0,
  };
  const historyReport = { ...report, stage: "wasm-node-compiler" };
  const rawLog = path.join(temporary, "build.raw.log");
  fs.writeFileSync(
    rawLog,
    `step NOOK_SCCACHE_STATS ${JSON.stringify(report)}\n`,
  );
  CacheTelemetry.listBuildHistory = () => [
    {
      ref: "history-ref",
      name: "wasm-node",
      status: "completed",
      started_at: "2026-09-15T01:00:00Z",
      completed_at: "2026-09-15T01:01:00Z",
      completed_steps: 1,
      total_steps: 1,
      cached_steps: 0,
    },
  ];
  CacheTelemetry.readHistoryEvents = () =>
    Promise.resolve([
      {
        logs: [
          {
            vertex: "sha256:wasm-node",
            timestamp: "2026-09-15T01:01:00Z",
            data: Buffer.from(
              `NOOK_SCCACHE_STATS ${JSON.stringify(historyReport)}\nNOOK_SCCACHE_FALLBACK {"backend":"direct_compile","reason":"cache_circuit_open","remote_writes":0}\n`,
            ).toString("base64"),
          },
        ],
      },
    ]);

  try {
    const record = await CacheTelemetry.collectTelemetry({
      baselineRefs: [],
      job: "wasm",
      runId: "1",
      runAttempt: "1",
      environment: {
        NOOK_BUILDKIT_RAW_LOG: rawLog,
        NOOK_SCCACHE_BACKEND: "remote",
        NOOK_SCCACHE_BACKEND_REASON: "persistent_s3_service",
        NOOK_CACHE_TELEMETRY_JOB_STATUS: "success",
      },
    });
    assert.equal(record.sccache.report_count, 2);
    assert.deepEqual(
      record.sccache.snapshots.map(({ stage }) => stage),
      ["wasm-node-test-and-coverage", "wasm-node-compiler"],
    );
    assert.deepEqual(record.sccache.fallback, {
      state: "active",
      reason: "none",
    });
  } finally {
    CacheTelemetry.listBuildHistory = originalListBuildHistory;
    CacheTelemetry.readHistoryEvents = originalReadHistoryEvents;
    fs.rmSync(temporary, { recursive: true, force: true });
  }
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
    remote_writes: 0,
    local_hits: 0,
    remote_hits: 0,
    local_writes: 0,
    local_write_errors: 0,
    remote_write_errors: 0,
    local_backfills: 0,
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
    'NOOK_SCCACHE_STATS {"stage":"compile-wasm","baked_runtime_mode":"READ_WRITE","runtime_mode":"READ_WRITE","runtime_mode_source":"runtime_secret","client_side":true,"counter_reliability":"backend_incomplete","publication_status":"counters_observed","compile_requests":602,"requests_executed":602,"cache_hits":592,"cache_misses":0,"cache_errors":0,"cache_write_errors":0,"cache_writes":0,"remote_writes":0,"local_hits":0,"remote_hits":592,"local_writes":0,"local_write_errors":0,"remote_write_errors":0,"local_backfills":0,"compile_failures":0}',
  ].join("\n");

  assert.deepEqual(CacheTelemetry.extractSccacheFallbackFromText(text), {
    state: "active",
    reason: "none",
  });
});

void test("a healthy terminal snapshot supersedes stale credential fallback history", () => {
  /** @type {SccacheReport} */
  const report = {
    stage: "compile-native-dependencies",
    baked_runtime_mode: "READ_WRITE",
    runtime_mode: "READ_WRITE",
    runtime_mode_source: "runtime_secret",
    client_side: false,
    counter_reliability: "authoritative",
    publication_status: "counters_observed",
    compile_requests: 339,
    requests_executed: 279,
    cache_hits: 275,
    cache_misses: 0,
    cache_errors: 0,
    cache_write_errors: 0,
    cache_writes: 0,
    remote_writes: 0,
    local_hits: 0,
    remote_hits: 275,
    local_writes: 0,
    local_write_errors: 0,
    remote_write_errors: 0,
    local_backfills: 0,
    compile_failures: 0,
  };
  assert.deepEqual(
    resolveSccacheFallback(
      [report],
      { state: "active", reason: "none" },
      { state: "fallback", reason: "credentials_unavailable" },
    ),
    { state: "active", reason: "none" },
  );
});

void test("a real raw fallback remains active despite healthy terminal evidence", () => {
  /** @type {SccacheReport} */
  const report = {
    stage: "dylint",
    baked_runtime_mode: "READ_WRITE",
    runtime_mode: "READ_WRITE",
    runtime_mode_source: "runtime_secret",
    client_side: false,
    counter_reliability: "authoritative",
    publication_status: "counters_observed",
    compile_requests: 32,
    requests_executed: 32,
    cache_hits: 0,
    cache_misses: 32,
    cache_errors: 0,
    cache_write_errors: 0,
    cache_writes: 32,
    remote_writes: 32,
    local_hits: 0,
    remote_hits: 0,
    local_writes: 0,
    local_write_errors: 0,
    remote_write_errors: 0,
    local_backfills: 0,
    compile_failures: 0,
  };
  /** @type {FallbackState} */
  const fallback = {
    state: "fallback",
    reason: "cache_circuit_open",
  };
  /** @type {FallbackState} */
  const active = { state: "active", reason: "none" };

  assert.deepEqual(
    resolveSccacheFallback([report], fallback, fallback),
    fallback,
  );
  assert.deepEqual(
    resolveSccacheFallback(
      [report],
      active,
      fallback,
      'NOOK_SCCACHE_FALLBACK {"backend":"direct_compile","reason":"cache_transport_unavailable","remote_writes":0}',
    ),
    { state: "fallback", reason: "cache_transport_unavailable" },
  );
  assert.deepEqual(resolveSccacheFallback([], active, fallback), fallback);
  assert.deepEqual(
    resolveSccacheFallback(
      [],
      active,
      active,
      'NOOK_SCCACHE_FALLBACK {"backend":"direct_compile","reason":"cache_circuit_open","remote_writes":0}',
    ),
    fallback,
  );
});

void test("rejects malformed nested telemetry records at the ingress", () => {
  assert.throws(
    () =>
      CacheTelemetry.validateTelemetryRecord({
        schema_version: 3,
        github: "invalid",
      }),
    /telemetry github context is required/,
  );
});

void test("rejects malformed cache-export byte measurement states", () => {
  const record = CacheTelemetry.buildUnavailableTelemetry({
    warning: "fixture",
    job: "compile",
    runId: "1",
    runAttempt: "1",
  });
  const malformedMeasurement = {
    ...record,
    buildkit: {
      ...record.buildkit,
      cache_export: {
        ...record.buildkit.cache_export,
        byte_measurement: {
          status: "unavailable",
          reason: "zero_assumed",
        },
      },
    },
  };

  assert.throws(
    () => CacheTelemetry.validateTelemetryRecord(malformedMeasurement),
    /telemetry buildkit.cache_export.byte_measurement is invalid/,
  );
});

void test("rejects malformed compile phase objects at the ingress", () => {
  const record = CacheTelemetry.buildUnavailableTelemetry({
    warning: "fixture",
    job: "compile",
    runId: "1",
    runAttempt: "1",
  });
  const malformedSource = {
    ...record,
    cache_scope: {
      ...record.cache_scope,
      compile_phases: {
        ...record.cache_scope.compile_phases,
        source_compile: "invalid",
      },
    },
  };
  const malformedFoundation = {
    ...record,
    cache_scope: {
      ...record.cache_scope,
      compile_phases: {
        ...record.cache_scope.compile_phases,
        foundation: {
          ...record.cache_scope.compile_phases.foundation,
          input_refs_access_verified: "invalid",
        },
      },
    },
  };

  assert.throws(
    () => CacheTelemetry.validateTelemetryRecord(malformedSource),
    /telemetry compile phase source_compile is invalid/,
  );
  assert.throws(
    () => CacheTelemetry.validateTelemetryRecord(malformedFoundation),
    /telemetry compile phase foundation.input_refs_access_verified is invalid/,
  );
});

void test("rejects telemetry without required compile phase evidence", () => {
  const record = CacheTelemetry.buildUnavailableTelemetry({
    warning: "fixture",
    job: "compile",
    runId: "1",
    runAttempt: "1",
  });
  const missingCompilePhases = {
    ...record,
    cache_scope: { ...record.cache_scope },
  };
  Reflect.deleteProperty(missingCompilePhases.cache_scope, "compile_phases");

  assert.throws(
    () => CacheTelemetry.validateTelemetryRecord(missingCompilePhases),
    /telemetry cache_scope\.compile_phases is required/,
  );
});

void test("rejects an unknown sccache fallback state", () => {
  const record = CacheTelemetry.buildUnavailableTelemetry({
    warning: "fixture",
    job: "compile",
    runId: "1",
    runAttempt: "1",
  });
  const malformed = {
    ...record,
    sccache: {
      ...record.sccache,
      fallback: { state: "unknown", reason: "fixture" },
    },
  };
  assert.throws(
    () => CacheTelemetry.validateTelemetryRecord(malformed),
    /telemetry sccache.fallback is invalid/,
  );
});

void test("reads telemetry recursively without relying on nonportable Dirent paths", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nook-cache-health-"),
  );
  const nestedTelemetry = CacheTelemetry.buildUnavailableTelemetry({
    warning: "fixture",
    job: "nested",
  });
  const nestedDirectory = path.join(directory, "artifact", "nested");
  fs.mkdirSync(nestedDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(nestedDirectory, "telemetry.json"),
    JSON.stringify(nestedTelemetry),
  );
  fs.writeFileSync(path.join(nestedDirectory, "ignored.txt"), "not json");
  try {
    assert.deepEqual(PrCacheHealth.readTelemetry(directory), [
      nestedTelemetry,
    ]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
