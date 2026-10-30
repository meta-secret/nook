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
import { BuildHistoryTelemetry } from "./build-history-telemetry.mjs";


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
