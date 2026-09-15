import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PrCacheHealth } from "./pr-cache-health.mjs";

/** @param {string} job @param {Record<string, any>} [overrides] */
const telemetry = (job, overrides = {}) => ({
  schema_version: 1,
  github: { run_id: "42", run_attempt: 1, job },
  cache_backend: { kind: "remote", persistent: true, reason: "persistent_s3_service" },
  cache_scope: {
    scope: "main",
    compile_dependencies: { scope: "deps", available: true, write_enabled: false, export_enabled: false },
    compile_source: { scope: "source", available: true, write_enabled: false, export_enabled: false },
    compiler_input: { fingerprint: "same-input", restore_fingerprint: "same-input" },
    imports: { probes_complete: true, availability: [{ name: "GHA_CACHE_EXACT_RUST_BASE_AVAILABLE", available: true }] },
  },
  sccache: { report_count: 1, baked_runtime_mode: "READ_WRITE", runtime_mode: "READ_WRITE", runtime_mode_source: "runtime_secret", client_side: true, counter_reliability: "backend_incomplete", publication_status: "counters_observed", compile_requests: 10, requests_executed: 10, cache_hits: 8, cache_misses: 2, cache_errors: 0, cache_write_errors: 0, cache_writes: 2, hit_rate_percent: 80 },
  buildkit: {
    build_record_count: 1,
    completed_steps: 100,
    cached_steps: 80,
    cache_hit_rate_percent: 80,
    cache_export: { attempts: 0, completed: 0, bytes: 0, duration_ms: 0, incomplete_failures: 0 },
    measurement: "buildx_target_record_steps",
  },
  buildkit_records: [],
  collection: { complete: true, warnings: [], failures: [] },
  ...overrides,
});

void test("passes warm no-export Docker jobs while sccache remains writable", () => {
  const model = new PrCacheHealth({ minimumBuildkitHitRate: 20 }).evaluate({
    jobs: [{ id: "verify", result: "success", buildExpected: true, readOnly: true }],
    telemetry: [telemetry("verify")],
  });
  assert.equal(model.gate.verdict, "pass");
  assert.deepEqual(model.gate.reasons, []);
  assert.match(PrCacheHealth.renderMarkdown(model), /80 cached \/ 100 completed/);
  assert.match(PrCacheHealth.renderMarkdown(model), /80%/);
  assert.match(PrCacheHealth.renderMarkdown(model), /1 available/);
  assert.match(PrCacheHealth.renderMarkdown(model), /0 ms/);
});

void test("fails missing telemetry, failed jobs, broken collection, and read-only exports", () => {
  const broken = telemetry("rust", {
    collection: { complete: false, warnings: ["logs unavailable"], failures: [] },
    buildkit: {
      build_record_count: 1,
      completed_steps: 20,
      cached_steps: 0,
      cache_hit_rate_percent: 0,
      cache_export: { attempts: 1, completed: 1, bytes: 20, duration_ms: 2, incomplete_failures: 0 },
      measurement: "buildx_target_record_steps",
    },
  });
  const model = new PrCacheHealth({ minimumBuildkitHitRate: 20 }).evaluate({
    jobs: [
      { id: "rust", result: "failure", buildExpected: true, readOnly: true },
      { id: "wasm", result: "success", buildExpected: true, readOnly: true },
    ],
    telemetry: [broken],
  });
  assert.equal(model.gate.verdict, "fail");
  assert.ok(model.gate.reasons.includes("rust:upstream_failure_or_timeout"));
  assert.ok(model.gate.reasons.includes("rust:telemetry_incomplete"));
  assert.ok(model.gate.reasons.includes("rust:unexpected_read_only_export"));
  assert.ok(model.gate.reasons.includes("rust:buildkit_cache_regression:0<20"));
  assert.ok(model.gate.reasons.includes("wasm:telemetry_missing"));
});

void test("does not invent a regression for cold, tiny, or handoff-only work", () => {
  const model = new PrCacheHealth({ minimumBuildkitHitRate: 20, minimumCompletedSteps: 20 }).evaluate({
    jobs: [
      { id: "wasm", result: "success", buildExpected: false, readOnly: true },
      { id: "verify", result: "success", buildExpected: true, readOnly: true },
    ],
    telemetry: [
      telemetry("wasm", { buildkit: { ...telemetry("wasm").buildkit, build_record_count: 0, completed_steps: 0, cached_steps: 0, cache_hit_rate_percent: undefined } }),
      telemetry("verify", { buildkit: { ...telemetry("verify").buildkit, completed_steps: 10, cached_steps: 0, cache_hit_rate_percent: 0 } }),
    ],
  });
  assert.equal(model.gate.verdict, "pass");
  assert.ok(model.warnings.includes("wasm:build_not_expected"));
  assert.ok(model.warnings.includes("verify:cache_sample_too_small:10<20"));
});

void test("activates the specialist for a bounded transient cache probe", () => {
  const record = telemetry("rust", {
    cache_scope: {
      ...telemetry("rust").cache_scope,
      imports: {
        probes_complete: true,
        failure_class: "transient_unavailable",
        availability: [],
      },
    },
  });
  const model = new PrCacheHealth().evaluate({
    jobs: [{ id: "rust", result: "success", buildExpected: true, readOnly: false }],
    telemetry: [record],
  });
  assert.equal(model.gate.verdict, "fail");
  assert.ok(model.gate.reasons.includes("rust:cache_import_probe_transient"));
});

void test("tracks image consumers without requiring BuildKit telemetry", () => {
  const skipped = new PrCacheHealth().evaluate({
    jobs: [
      { id: "ui-demo", result: "skipped", buildExpected: false, readOnly: true, consumer: true },
    ],
    telemetry: [],
  });
  assert.equal(skipped.gate.verdict, "pass");
  assert.ok(skipped.warnings.includes("ui-demo:telemetry_not_expected"));

  const failed = new PrCacheHealth().evaluate({
    jobs: [
      { id: "extension-e2e", result: "failure", buildExpected: false, readOnly: true, consumer: true },
    ],
    telemetry: [],
    consumerSentinels: { started: new Set(["extension-e2e"]), completed: new Set(["extension-e2e"]) },
  });
  assert.equal(failed.gate.verdict, "pass");
  assert.ok(failed.warnings.includes("extension-e2e:consumer_functional_failure"));

  const cancelled = new PrCacheHealth().evaluate({
    jobs: [
      { id: "full-e2e-shard", result: "cancelled", buildExpected: false, readOnly: true, consumer: true },
    ],
    telemetry: [],
  });
  assert.equal(cancelled.gate.verdict, "pass");
  assert.ok(cancelled.warnings.includes("full-e2e-shard:consumer_cancelled_without_timeout_proof"));

  const timedOut = new PrCacheHealth().evaluate({
    jobs: [{ id: "full-e2e-shard-1", result: "failure", buildExpected: false, readOnly: true, consumer: true }],
    telemetry: [],
    consumerSentinels: { started: new Set(["full-e2e-shard-1"]), completed: new Set() },
  });
  assert.equal(timedOut.gate.verdict, "fail");
  assert.ok(timedOut.gate.reasons.includes("full-e2e-shard-1:consumer_setup_or_timeout"));
});

void test("records a legitimate cold build without applying the warm threshold", () => {
  const cold = telemetry("rust", {
    sccache: {
      ...telemetry("rust").sccache,
      runtime_mode: "READ_WRITE",
      publication_status: "pending_verification",
      cache_hits: 0,
    },
    cache_scope: {
      ...telemetry("rust").cache_scope,
      imports: {
        probes_complete: true,
        availability: [
          { name: "GHA_CACHE_EXACT_RUST_BASE_AVAILABLE", available: false },
        ],
      },
    },
    buildkit: {
      ...telemetry("rust").buildkit,
      completed_steps: 100,
      cached_steps: 0,
      cache_hit_rate_percent: 0,
    },
  });
  const model = new PrCacheHealth().evaluate({
    jobs: [
      { id: "rust", result: "success", buildExpected: true, readOnly: false },
    ],
    telemetry: [cold],
  });
  assert.equal(model.gate.verdict, "pass");
  assert.ok(model.warnings.includes("rust:cold_cache_no_available_imports"));
  assert.ok(model.warnings.includes("rust:publication_pending_verification"));
});

void test("fails changed-head zero-hit verification and cache write errors", () => {
  const successor = telemetry("rust", {
    sccache: {
      ...telemetry("rust").sccache,
      runtime_mode: "READ_WRITE",
      publication_status: "pending_verification",
      cache_hits: 0,
      cache_write_errors: 1,
    },
    cache_scope: {
      ...telemetry("rust").cache_scope,
      compile_source: {
        ...telemetry("rust").cache_scope.compile_source,
        scope: "nook-build-compile-v4-git-new",
        restore_scope: "nook-build-compile-v4-git-parent",
      },
    },
  });
  const model = new PrCacheHealth().evaluate({
    jobs: [
      { id: "rust", result: "success", buildExpected: true, readOnly: false },
    ],
    telemetry: [successor],
  });
  assert.equal(model.gate.verdict, "fail");
  assert.ok(model.gate.reasons.includes("rust:sccache_write_errors:1"));
  assert.ok(model.gate.reasons.includes("rust:sccache_next_head_zero_hits"));
  assert.ok(!model.gate.reasons.includes("rust:telemetry_incomplete"));
});

void test("does not require sccache hits for unrelated BuildKit imports", () => {
  const unrelated = telemetry("rust", {
    sccache: {
      ...telemetry("rust").sccache,
      publication_status: "pending_verification",
      cache_hits: 0,
      cache_misses: 10,
    },
    cache_scope: {
      ...telemetry("rust").cache_scope,
      compiler_input: {
        fingerprint: "new-input",
        restore_fingerprint: "old-input",
      },
    },
  });
  const model = new PrCacheHealth().evaluate({
    jobs: [{ id: "rust", result: "success", buildExpected: true, readOnly: false }],
    telemetry: [unrelated],
  });
  assert.equal(model.gate.verdict, "pass");
  assert.ok(model.warnings.includes("rust:publication_pending_verification"));
  assert.ok(!model.gate.reasons.includes("rust:sccache_next_head_zero_hits"));
});

void test("reads telemetry recursively without relying on nonportable Dirent paths", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nook-cache-health-"));
  const nestedDirectory = path.join(directory, "artifact", "nested");
  fs.mkdirSync(nestedDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(nestedDirectory, "telemetry.json"),
    JSON.stringify(telemetry("nested")),
  );
  fs.writeFileSync(path.join(nestedDirectory, "ignored.txt"), "not json");
  try {
    assert.deepEqual(PrCacheHealth.readTelemetry(directory), [
      telemetry("nested"),
    ]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

void test("reads browser consumer lifecycle sentinels recursively", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nook-cache-consumer-"));
  const nestedDirectory = path.join(directory, "artifact");
  fs.mkdirSync(nestedDirectory, { recursive: true });
  fs.writeFileSync(path.join(nestedDirectory, "one.started"), "ui-demo\n");
  fs.writeFileSync(path.join(nestedDirectory, "one.completed"), "ui-demo\n");
  try {
    const sentinels = PrCacheHealth.readConsumerSentinels(directory);
    assert.deepEqual([...sentinels.started], ["ui-demo"]);
    assert.deepEqual([...sentinels.completed], ["ui-demo"]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

void test("PR workflow covers every BuildKit-producing job without another build", () => {
  const workflow = fs.readFileSync(".github/workflows/pr.yml", "utf8");
  const ecosystem = fs.readFileSync(
    ".github/workflows/rust-ecosystem-checks.yml",
    "utf8",
  );
  assert.match(workflow, /cache-health:\n[\s\S]*needs: \[rust-ecosystem, rust, wasm, wasm-node-test, verify, ui-demo, extension-e2e, full-e2e-shard\]/);
  assert.match(workflow, /node \.github\/workflows\/lib\/pr-cache-health\.mjs/);
  assert.match(workflow, /pattern: cache-consumer-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}-\*/);
  assert.equal(
    workflow.match(/name: Mark browser cache consumer started/g)?.length,
    3,
  );
  assert.match(workflow, /full-e2e-shard-\$\{\{ matrix\.shard \}\}\.completed/);
  assert.equal(
    workflow.match(/name: Mark browser cache consumer completed/g)?.length,
    3,
  );
  assert.match(workflow, /nook-cache-consumer\/ui-demo\.\*/);
  assert.match(workflow, /nook-cache-consumer\/extension-e2e\.\*/);
  assert.doesNotMatch(workflow, /cache-health:[\s\S]*docker buildx (?:build|bake)/);
  assert.doesNotMatch(workflow, /ARC keeps the verified (?:native|WASM|web) graph local/);
  assert.equal(
    ecosystem.match(/uses: \.\/\.github\/actions\/nook-cache-telemetry/g)?.length,
    3,
  );
});
