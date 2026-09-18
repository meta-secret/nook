import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CacheTelemetry } from "./cache-telemetry.mjs";
import { BuildHistoryBaseline } from "./cache-telemetry-baseline.mjs";

const historyRecord = {
  ref: "stable-native-build",
  name: "pr-native-build",
  status: "completed",
  started_at: "2026-09-17T01:00:00Z",
  completed_at: "2026-09-17T01:04:00Z",
  completed_steps: 20,
  total_steps: 20,
  cached_steps: 14,
};

void test("publishes Buildx record identities in the telemetry baseline", async () => {
  const originalListBuildHistory =
    CacheTelemetry.listBuildHistory.bind(CacheTelemetry);
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nook-cache-baseline-"),
  );
  const output = path.join(directory, "baseline.json");
  CacheTelemetry.listBuildHistory = () => [historyRecord];

  try {
    await CacheTelemetry.main(["start", "--output", output]);
    const baseline = BuildHistoryBaseline.parse({
      text: fs.readFileSync(output, "utf8"),
      normalize: (record) => CacheTelemetry.normalizeBuildRecord(record),
    });
    const [baselineRecord] = baseline.records;
    if (!baselineRecord) throw new Error("baseline record missing");
    assert.equal(
      BuildHistoryBaseline.identity(baselineRecord),
      BuildHistoryBaseline.identity(historyRecord),
    );
    assert.deepEqual(baseline.refs, [historyRecord.ref]);
  } finally {
    CacheTelemetry.listBuildHistory = originalListBuildHistory;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

void test("ignores non-record baseline entries at the JSON boundary", () => {
  const baseline = BuildHistoryBaseline.parse({
    text: JSON.stringify({
      refs: [historyRecord.ref],
      records: [historyRecord, "not-a-record", 42],
      warnings: ["baseline warning"],
    }),
    normalize: (record) => CacheTelemetry.normalizeBuildRecord(record),
  });

  assert.deepEqual(baseline.records, [
    CacheTelemetry.normalizeBuildRecord(historyRecord),
  ]);
  assert.deepEqual(baseline.refs, [historyRecord.ref]);
  assert.deepEqual(baseline.warnings, ["baseline warning"]);
});

void test("keeps a completed successor that reuses a baseline Buildx ref", async () => {
  const originalListBuildHistory =
    CacheTelemetry.listBuildHistory.bind(CacheTelemetry);
  const originalReadHistoryEvents =
    CacheTelemetry.readHistoryEvents.bind(CacheTelemetry);
  CacheTelemetry.listBuildHistory = () => [
    {
      ...historyRecord,
      started_at: "2026-09-17T02:00:00Z",
      completed_at: "2026-09-17T02:04:00Z",
      completed_steps: 24,
      total_steps: 24,
      cached_steps: 18,
    },
  ];
  CacheTelemetry.readHistoryEvents = () => Promise.resolve([]);

  try {
    const record = await CacheTelemetry.collectTelemetry({
      baselineRefs: [historyRecord.ref],
      baselineRecords: [historyRecord],
      job: "rust-build",
      runId: "35310250418",
      runAttempt: "1",
      environment: {
        NOOK_SCCACHE_BACKEND: "remote",
        NOOK_SCCACHE_BACKEND_REASON: "persistent_service",
        NOOK_CACHE_TELEMETRY_JOB_STATUS: "success",
      },
    });

    assert.equal(record.collection.complete, true);
    assert.equal(record.buildkit.build_record_count, 1);
    assert.equal(record.buildkit.completed_steps, 24);
  } finally {
    CacheTelemetry.listBuildHistory = originalListBuildHistory;
    CacheTelemetry.readHistoryEvents = originalReadHistoryEvents;
  }
});
