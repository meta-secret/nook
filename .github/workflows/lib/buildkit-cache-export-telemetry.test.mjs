import assert from "node:assert/strict";
import test from "node:test";

import { BuildkitCacheExportTelemetry } from "./buildkit-cache-export-telemetry.mjs";
import { BuildkitPlainLogTelemetry } from "./buildkit-plain-log-telemetry.mjs";

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
    byte_measurement: { status: "measured", bytes: 5120 },
    duration_ms: 3250,
    incomplete_failures: 1,
  });
});

void test("treats completed structured zero counters as unavailable placeholder data", () => {
  const summary = new BuildkitCacheExportTelemetry([
    {
      vertexes: [
        {
          digest: "sha256:complete",
          name: "exporting cache to registry",
          started: "2026-09-13T01:00:00Z",
          completed: "2026-09-13T01:00:01Z",
        },
      ],
      statuses: [
        {
          vertex: "sha256:complete-transfer",
          id: "push",
          name: "pushing cache manifest",
          current: 0,
          total: 0,
        },
      ],
    },
  ]).summary();

  assert.deepEqual(summary.byte_measurement, {
    status: "unavailable",
    reason: "buildkit_did_not_emit_byte_count",
  });
});

void test("does not infer zero bytes from exporter statuses without counters", () => {
  const summary = new BuildkitCacheExportTelemetry([
    {
      vertexes: [
        {
          digest: "sha256:complete",
          name: "exporting cache to registry",
          started: "2026-09-13T01:00:00Z",
          completed: "2026-09-13T01:00:01Z",
        },
      ],
      statuses: [
        {
          vertex: "sha256:complete-transfer",
          id: "push",
          name: "pushing cache manifest",
        },
      ],
    },
  ]).summary();

  assert.deepEqual(summary.byte_measurement, {
    status: "unavailable",
    reason: "buildkit_did_not_emit_byte_count",
  });
});

void test("treats a completed plain-log zero transfer as unavailable placeholder data", () => {
  const summary = new BuildkitPlainLogTelemetry(
    [
      "#93 exporting cache to registry",
      "#93 writing cache manifest sha256:bbbbbbbb 0B / 0B done",
      "#93 DONE 7.4s",
    ].join("\n"),
  ).summary();

  assert.deepEqual(summary.byte_measurement, {
    status: "unavailable",
    reason: "buildkit_did_not_emit_byte_count",
  });
});
