import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CacheScopeTelemetry,
  CacheTelemetry,
} from "./cache-telemetry.mjs";
import {
  CompilePhaseCacheExportMode,
  CompilePhaseStatus,
} from "./cache-scope-telemetry.mjs";
import { resolveSccacheFallback } from "./cache-telemetry-fallback.mjs";
import { BuildHistoryTelemetry } from "./build-history-telemetry.mjs";

/** @typedef {import("./cache-telemetry-contracts.mjs").SccacheReport} SccacheReport */
/** @typedef {{state: 'active' | 'fallback', reason: string}} FallbackState */

void test("records the active compile scope without preselection state", () => {
  assert.deepEqual(
    new CacheScopeTelemetry({
      GHA_CACHE_SCOPE_SUFFIX: `-git-${"b".repeat(40)}`,
      GHA_CACHE_PARENT_SCOPE_SUFFIX: `-git-${"a".repeat(40)}`,
      NOOK_REGISTRY_CACHE_HOST: "registry.dev.nokey.sh",
    }).record(),
    {
      scope: "",
      compile_dependencies: {
        scope: "",
        available: false,
        write_enabled: false,
        export_enabled: false,
      },
      compile_source: {
        scope: `nook-build-compile-git-${"b".repeat(40)}`,
        parent_scope_suffix: `-git-${"a".repeat(40)}`,
        parent_ref: `registry.dev.nokey.sh/nook/remote-buildcache/nook-build-compile-git-${"a".repeat(40)}:buildcache`,
      },
      compile_phases: {
        foundation: {
          requested: false,
          target: "build-compile-foundation",
          status: CompilePhaseStatus.NotRequested,
          cache_from: [],
          cache_to: {
            enabled: false,
            ref: "",
            mode: CompilePhaseCacheExportMode.Disabled,
          },
          input_refs_access_verified: false,
        },
        source_compile: {
          requested: false,
          target: "build-compile",
          status: CompilePhaseStatus.NotRequested,
          cache_from: [],
          cache_to: {
            enabled: false,
            ref: "",
            mode: CompilePhaseCacheExportMode.Disabled,
          },
        },
      },
      imports: {
        probes_complete: false,
        failure_class: "none",
        availability: [],
      },
    },
  );
});

void test("records the two compile phases with the authorized exporter only in Phase A", () => {
  const currentSuffix = `-git-${"b".repeat(40)}`;
  const parentSuffix = `-git-${"a".repeat(40)}`;
  const compilePhases = new CacheScopeTelemetry({
    NOOK_REMOTE_TASK_SELECTION: "build:compile",
    GHA_CACHE_ENABLED: "1",
    GHA_CACHE_WRITE_ENABLED: "1",
    GHA_CACHE_SCOPE_SUFFIX: currentSuffix,
    GHA_CACHE_PARENT_SCOPE_SUFFIX: parentSuffix,
    NOOK_REGISTRY_CACHE_HOST: "registry.dev.nokey.sh",
    NOOK_COMPILE_CACHE_MODE: "publish",
    NOOK_BUILD_COMPILE_FOUNDATION_STATUS: CompilePhaseStatus.Completed,
    NOOK_BUILD_COMPILE_SOURCE_STATUS: CompilePhaseStatus.Running,
    NOOK_BUILD_COMPILE_CACHE_IMPORTS_VERIFIED: "1",
  }).record().compile_phases;
  const currentRef = `registry.dev.nokey.sh/nook/remote-buildcache/nook-build-compile${currentSuffix}:buildcache`;
  const parentRef = `registry.dev.nokey.sh/nook/remote-buildcache/nook-build-compile${parentSuffix}:buildcache`;

  assert.deepEqual(compilePhases.foundation, {
    requested: true,
    target: "build-compile-foundation",
    status: CompilePhaseStatus.Completed,
    cache_from: [currentRef, parentRef],
    cache_to: {
      enabled: true,
      ref: currentRef,
      mode: CompilePhaseCacheExportMode.Max,
    },
    input_refs_access_verified: true,
  });
  assert.deepEqual(compilePhases.source_compile, {
    requested: true,
    target: "build-compile",
    status: CompilePhaseStatus.Running,
    cache_from: [currentRef],
    cache_to: {
      enabled: false,
      ref: "",
      mode: CompilePhaseCacheExportMode.Disabled,
    },
  });
});

void test("records the persisted remote workflow handoff after both compile phases", () => {
  const currentSuffix = `-git-${"b".repeat(40)}`;
  const scope = new CacheScopeTelemetry({
    NOOK_REMOTE_TASK_SELECTION: "build:compile",
    GHA_CACHE_ENABLED: "1",
    GHA_CACHE_SCOPE_SUFFIX: currentSuffix,
    NOOK_REGISTRY_CACHE_HOST: "registry.dev.nokey.sh",
    NOOK_BUILD_COMPILE_FOUNDATION_STATUS: "completed",
    NOOK_BUILD_COMPILE_SOURCE_STATUS: "completed",
    NOOK_BUILD_COMPILE_CACHE_IMPORTS_VERIFIED: "1",
    GHA_CACHE_EXACT_PROBES_COMPLETE: "1",
    GHA_CACHE_EXACT_PROBE_FAILURE_CLASS: "none",
  }).record();

  assert.equal(scope.compile_phases.foundation.requested, true);
  assert.equal(
    scope.compile_phases.foundation.status,
    CompilePhaseStatus.Completed,
  );
  assert.equal(scope.compile_phases.source_compile.requested, true);
  assert.equal(
    scope.compile_phases.source_compile.status,
    CompilePhaseStatus.Completed,
  );
  assert.equal(scope.imports.probes_complete, true);
  assert.equal(scope.imports.failure_class, "none");
});

void test("normalizes an invalid persisted phase status to not started", () => {
  const phases = new CacheScopeTelemetry({
    NOOK_REMOTE_TASK_SELECTION: "build:compile",
    NOOK_BUILD_COMPILE_FOUNDATION_STATUS: "unexpected",
    NOOK_BUILD_COMPILE_SOURCE_STATUS: "unexpected",
  }).record().compile_phases;

  assert.equal(phases.foundation.status, CompilePhaseStatus.NotStarted);
  assert.equal(phases.source_compile.status, CompilePhaseStatus.NotStarted);
});

void test("records both phases without registry exporters for no-export compile verification", () => {
  const currentSuffix = `-git-${"b".repeat(40)}`;
  const currentRef = `registry.dev.nokey.sh/nook/remote-buildcache/nook-build-compile${currentSuffix}:buildcache`;
  const compilePhases = new CacheScopeTelemetry({
    NOOK_REMOTE_TASK_SELECTION: "build:compile",
    GHA_CACHE_ENABLED: "1",
    GHA_CACHE_WRITE_ENABLED: "",
    GHA_CACHE_SCOPE_SUFFIX: currentSuffix,
    GHA_CACHE_PARENT_SCOPE_SUFFIX: "",
    NOOK_REGISTRY_CACHE_HOST: "registry.dev.nokey.sh",
    NOOK_COMPILE_CACHE_MODE: "read-only",
    NOOK_BUILD_COMPILE_FOUNDATION_STATUS: CompilePhaseStatus.Completed,
    NOOK_BUILD_COMPILE_SOURCE_STATUS: CompilePhaseStatus.Completed,
    NOOK_BUILD_COMPILE_CACHE_IMPORTS_VERIFIED: "1",
  }).record().compile_phases;

  assert.deepEqual(compilePhases.foundation.cache_from, [currentRef]);
  assert.deepEqual(compilePhases.foundation.cache_to, {
    enabled: false,
    ref: "",
    mode: CompilePhaseCacheExportMode.Disabled,
  });
  assert.deepEqual(compilePhases.source_compile.cache_from, [currentRef]);
  assert.deepEqual(compilePhases.source_compile.cache_to, {
    enabled: false,
    ref: "",
    mode: CompilePhaseCacheExportMode.Disabled,
  });
});

void test("records a failed source phase after the foundation has completed", () => {
  const phases = new CacheScopeTelemetry({
    NOOK_REMOTE_TASK_SELECTION: "build:compile",
    GHA_CACHE_ENABLED: "1",
    GHA_CACHE_SCOPE_SUFFIX: `-git-${"b".repeat(40)}`,
    NOOK_REGISTRY_CACHE_HOST: "registry.dev.nokey.sh",
    NOOK_BUILD_COMPILE_FOUNDATION_STATUS: CompilePhaseStatus.Completed,
    NOOK_BUILD_COMPILE_SOURCE_STATUS: CompilePhaseStatus.Failed,
  }).record().compile_phases;

  assert.equal(phases.foundation.status, CompilePhaseStatus.Completed);
  assert.equal(phases.source_compile.status, CompilePhaseStatus.Failed);
  assert.equal(phases.source_compile.cache_to.enabled, false);
});

void test("records transient optional probe failures without marking probes incomplete", () => {
  const scope = new CacheScopeTelemetry({
    GHA_CACHE_EXACT_PROBES_COMPLETE: "1",
    GHA_CACHE_EXACT_PROBE_FAILURE_CLASS: "transient_unavailable",
  }).record();

  assert.equal(scope.imports.probes_complete, true);
  assert.equal(scope.imports.failure_class, "transient_unavailable");
  assert.equal(scope.compile_dependencies.available, false);
  assert.equal(Object.hasOwn(scope.compile_source, "available"), false);
});

void test("records an explicit empty parent cache identity for a root commit", () => {
  const source = new CacheScopeTelemetry({
    GHA_CACHE_SCOPE_SUFFIX: `-git-${"b".repeat(40)}`,
    NOOK_REGISTRY_CACHE_HOST: "registry.dev.nokey.sh",
  }).record().compile_source;

  assert.deepEqual(
    {
      parent_scope_suffix: source.parent_scope_suffix,
      parent_ref: source.parent_ref,
    },
    { parent_scope_suffix: "", parent_ref: "" },
  );
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

void test("does not count concurrent unfinished records for a successful job", () => {
  const records = [
    {
      ref: "completed",
      name: "completed",
      status: "completed",
      completed_at: "2026-09-06T04:00:00Z",
      started_at: "2026-09-06T03:00:00Z",
      completed_steps: 2,
      total_steps: 2,
      cached_steps: 1,
    },
    {
      ref: "concurrent",
      name: "concurrent",
      status: "running",
      started_at: "2026-09-06T05:00:00Z",
      completed_steps: 1,
      total_steps: 2,
      cached_steps: 0,
    },
  ];

  assert.deepEqual(
    CacheTelemetry.selectBuildRecords(records, 32, {
      includeUnfinished: false,
    }),
    {
      records: [records[0]],
      warnings: [],
    },
  );
  assert.deepEqual(
    CacheTelemetry.selectBuildRecords(records, 32, {
      includeUnfinished: true,
    }).records,
    [records[1], records[0]],
  );
});

void test("production selection retains every current Buildx record", () => {
  const records = Array.from({ length: 36 }, (_, index) => ({
    ref: `record-${index}`,
    name: `record-${index}`,
    status: "completed",
    started_at: `2026-09-06T${String(index).padStart(2, "0")}:00:00Z`,
    completed_at: `2026-09-06T${String(index).padStart(2, "0")}:01:00Z`,
    completed_steps: 1,
    total_steps: 1,
    cached_steps: 1,
  }));

  const selection = CacheTelemetry.selectBuildRecords(records);
  assert.equal(selection.records.length, records.length);
  assert.deepEqual(selection.warnings, []);
  assert.equal(selection.records[0]?.ref, "record-35");
  assert.equal(selection.records.at(-1)?.ref, "record-0");
});

void test("records Docker history unavailability as an incomplete collection", async () => {
  const originalListBuildHistory =
    CacheTelemetry.listBuildHistory.bind(CacheTelemetry);
  CacheTelemetry.listBuildHistory = () => {
    throw new Error("Cannot connect to the Docker daemon");
  };

  try {
    const record = await CacheTelemetry.collectTelemetry({
      baselineRefs: [],
      job: "cache-health",
      runId: "35004445393",
      runAttempt: "1",
      environment: {
        NOOK_SCCACHE_BACKEND: "remote",
        NOOK_SCCACHE_BACKEND_REASON: "persistent_service",
      },
    });
    assert.equal(record.collection.complete, false);
    assert.ok(
      record.collection.warnings.some((warning) =>
        warning.startsWith("buildx_history_unavailable:"),
      ),
    );
    assert.ok(
      record.collection.failures.some(
        (failure) =>
          failure.component === "buildx_history" &&
          failure.reference === "current",
      ),
    );
    assert.equal(record.buildkit.build_record_count, 0);
  } finally {
    CacheTelemetry.listBuildHistory = originalListBuildHistory;
  }
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
    BuildHistoryTelemetry.readHistoryEvents.toString(),
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
      byte_measurement: {
        status: "unavailable",
        reason: "buildkit_did_not_emit_byte_count",
      },
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
    remote_writes: 2,
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
    'step NOOK_SCCACHE_STATS {"stage":"native","baked_runtime_mode":"READ_WRITE","runtime_mode":"READ_WRITE","runtime_mode_source":"runtime_secret","client_side":true,"counter_reliability":"backend_incomplete","publication_status":"counters_observed","compile_requests":12,"requests_executed":10,"cache_hits":8,"cache_misses":2,"cache_errors":0,"cache_write_errors":0,"cache_writes":2,"remote_writes":2,"compile_failures":0}\ncancelled\n';
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
    'NOOK_SCCACHE_STATS {"stage":"compile-wasm","baked_runtime_mode":"READ_WRITE","runtime_mode":"READ_WRITE","runtime_mode_source":"runtime_secret","client_side":true,"counter_reliability":"backend_incomplete","publication_status":"counters_observed","compile_requests":602,"requests_executed":602,"cache_hits":592,"cache_misses":0,"cache_errors":0,"cache_write_errors":0,"cache_writes":0,"remote_writes":0,"compile_failures":0}',
  ].join("\n");

  assert.deepEqual(CacheTelemetry.extractSccacheFallbackFromText(text), {
    state: "active",
    reason: "none",
  });
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
        schema_version: 2,
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
