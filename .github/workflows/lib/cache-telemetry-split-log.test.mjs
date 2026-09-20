import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CacheScopeTelemetry, CacheTelemetry } from "./cache-telemetry.mjs";

/** @typedef {{stage: string, hits: number, misses: number}} SccacheFixtureReport */
class SplitBuildLogFixture {
  /** @param {SccacheFixtureReport} fixture */
  static report({ stage, hits, misses }) {
    return JSON.stringify({
      stage,
      baked_runtime_mode: "READ_WRITE",
      runtime_mode: "READ_WRITE",
      runtime_mode_source: "runtime_secret",
      client_side: true,
      counter_reliability: "backend_incomplete",
      publication_status: "counters_observed",
      compile_requests: hits + misses,
      requests_executed: hits + misses,
      cache_hits: hits,
      cache_misses: misses,
      cache_errors: 0,
      cache_write_errors: 0,
      cache_writes: misses,
      remote_writes: misses,
      compile_failures: 0,
    });
  }
}

void test("aggregates sccache and exporter evidence from appended Phase A and Phase B plain logs", async () => {
  const originalListBuildHistory =
    CacheTelemetry.listBuildHistory.bind(CacheTelemetry);
  const originalReadHistoryEvents =
    CacheTelemetry.readHistoryEvents.bind(CacheTelemetry);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "nook-split-log-"));
  const rawLog = path.join(temporary, "nook-build-compile.raw.log");
  fs.writeFileSync(
    rawLog,
    [
      "NOOK_BUILDKIT_PHASE phase=foundation event=started",
      `\u001b[38;5;82m#71 9.2 NOOK_SCCACHE_STATS ${SplitBuildLogFixture.report({ stage: "native-dependencies", hits: 18, misses: 2 })}\u001b[0m`,
      "\u001b[32m#93 0.0 exporting cache to registry\u001b[0m",
      "#93 preparing build cache for export 4.1s done",
      "#93 writing layer sha256:aaaaaaaa 12.5MB / 12.5MB 2.0s done",
      "#93 writing cache manifest sha256:bbbbbbbb 1.2kB / 1.2kB done",
      "\u001b[32m#93 DONE 7.4s\u001b[0m",
      `#94 0.1 NOOK_SCCACHE_STATS ${SplitBuildLogFixture.report({ stage: "wasm-dependencies", hits: 74, misses: 29 })}`,
      "NOOK_BUILDKIT_PHASE phase=foundation event=completed",
      "NOOK_BUILDKIT_PHASE phase=source_compile event=started",
      "NOOK_BUILDKIT_PHASE phase=source_compile event=completed",
      "",
    ].join("\n"),
  );
  CacheTelemetry.listBuildHistory = () => [
    {
      ref: "phase-a-history",
      name: "build-compile-foundation",
      status: "completed",
      completed_at: "2026-09-17T01:01:00Z",
      completed_steps: 117,
      total_steps: 117,
      cached_steps: 92,
    },
  ];
  CacheTelemetry.readHistoryEvents = () =>
    Promise.resolve([
      {
        vertexes: [
          {
            digest: "sha256:export",
            name: "exporting cache to registry",
            started: "2026-09-17T01:00:52Z",
            completed: "2026-09-17T01:00:59.4Z",
          },
        ],
      },
    ]);

  try {
    const record = await CacheTelemetry.collectTelemetry({
      baselineRefs: [],
      environment: {
        NOOK_BUILDKIT_RAW_LOG: rawLog,
        NOOK_SCCACHE_BACKEND: "remote",
        NOOK_CACHE_TELEMETRY_JOB_STATUS: "success",
      },
    });
    assert.equal(record.sccache.report_count, 2);
    assert.equal(record.sccache.cache_hits, 92);
    assert.equal(record.sccache.cache_misses, 31);
    assert.deepEqual(record.buildkit.cache_export, {
      attempts: 1,
      completed: 1,
      byte_measurement: { status: "measured", bytes: 12_501_200 },
      duration_ms: 7400,
      incomplete_failures: 0,
    });
  } finally {
    CacheTelemetry.listBuildHistory = originalListBuildHistory;
    CacheTelemetry.readHistoryEvents = originalReadHistoryEvents;
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

void test("reports unavailable bytes when a successful registry export emits no byte lines", async () => {
  const originalListBuildHistory =
    CacheTelemetry.listBuildHistory.bind(CacheTelemetry);
  const originalReadHistoryEvents =
    CacheTelemetry.readHistoryEvents.bind(CacheTelemetry);
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "nook-export-no-bytes-"),
  );
  const rawLog = path.join(temporary, "nook-build-compile.raw.log");
  fs.writeFileSync(
    rawLog,
    [
      "#93 exporting cache to registry",
      "#93 preparing build cache for export 4.1s done",
      "#93 writing cache manifest sha256:bbbbbbbb done",
      "#93 DONE 7.4s",
      "",
    ].join("\n"),
  );
  CacheTelemetry.listBuildHistory = () => [];
  CacheTelemetry.readHistoryEvents = () => Promise.resolve([]);

  try {
    const record = await CacheTelemetry.collectTelemetry({
      baselineRefs: [],
      environment: {
        NOOK_BUILDKIT_RAW_LOG: rawLog,
        NOOK_CACHE_TELEMETRY_JOB_STATUS: "success",
      },
    });
    assert.deepEqual(record.buildkit.cache_export, {
      attempts: 1,
      completed: 1,
      byte_measurement: {
        status: "unavailable",
        reason: "buildkit_did_not_emit_byte_count",
      },
      duration_ms: 7400,
      incomplete_failures: 0,
    });
  } finally {
    CacheTelemetry.listBuildHistory = originalListBuildHistory;
    CacheTelemetry.readHistoryEvents = originalReadHistoryEvents;
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

void test("reports persisted current and parent compile-cache availability", () => {
  const availability = new CacheScopeTelemetry({
    GHA_CACHE_EXACT_COMPILE_CURRENT_AVAILABLE: "0",
    GHA_CACHE_EXACT_COMPILE_PARENT_AVAILABLE: "1",
    GHA_CACHE_EXACT_PROBES_COMPLETE: "1",
  }).record().imports;

  assert.equal(availability.probes_complete, true);
  assert.deepEqual(availability.availability, [
    { name: "GHA_CACHE_EXACT_COMPILE_CURRENT_AVAILABLE", available: false },
    { name: "GHA_CACHE_EXACT_COMPILE_PARENT_AVAILABLE", available: true },
  ]);
});

void test("registry verifier persists both compile-cache availability observations", () => {
  const action = fs.readFileSync(
    path.resolve(".github/actions/nook-docker-setup/action.yml"),
    "utf8",
  );
  assert.match(action, /GHA_CACHE_EXACT_COMPILE_CURRENT_AVAILABLE/);
  assert.match(action, /GHA_CACHE_EXACT_COMPILE_PARENT_AVAILABLE/);
  assert.match(
    action,
    /fs\.appendFileSync\([\s\S]*?environmentFile,[\s\S]*?`\$\{cacheAvailability\.name\}=\$\{value\}\\n`/,
  );
});

void test("Phase A keeps its rooted graph free of per-run telemetry cache busters", () => {
  const dockerfile = fs.readFileSync(
    path.resolve("nook-app/nook-platform/docker/rust/compile/Dockerfile"),
    "utf8",
  );
  const bake = fs.readFileSync(
    path.resolve("nook-app/nook-platform/docker/rust/compile/docker-bake.hcl"),
    "utf8",
  );
  assert.match(
    dockerfile,
    /FROM compile-web-extension-dependencies AS compile-foundation/,
  );
  assert.doesNotMatch(dockerfile, /nook-sccache-report --replay/);
  assert.match(bake, /target\s+= "compile-foundation"/);
  assert.doesNotMatch(bake, /NOOK_SCCACHE_TELEMETRY_REPLAY/);
});
