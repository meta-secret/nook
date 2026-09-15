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
  cache_backend: {
    kind: "remote",
    persistent: true,
    reason: "persistent_s3_service",
  },
  cache_scope: {
    scope: "main",
    compile_dependencies: {
      scope: "deps",
      available: true,
      write_enabled: false,
      export_enabled: false,
    },
    compile_source: {
      scope: "source",
      available: true,
      write_enabled: false,
      export_enabled: false,
    },
    imports: {
      probes_complete: true,
      availability: [
        { name: "GHA_CACHE_EXACT_RUST_BASE_AVAILABLE", available: true },
      ],
    },
  },
  sccache: {
    report_count: 1,
    baked_runtime_mode: "READ_WRITE",
    runtime_mode: "READ_WRITE",
    runtime_mode_source: "runtime_secret",
    client_side: true,
    counter_reliability: "backend_incomplete",
    publication_status: "counters_observed",
    compile_requests: 10,
    requests_executed: 10,
    cache_hits: 8,
    cache_misses: 2,
    cache_errors: 0,
    cache_write_errors: 0,
    cache_writes: 2,
    compile_failures: 0,
    measurement: "sum_of_zero_based_run_snapshots",
    fallback: { state: "active", reason: "none" },
    snapshots: [],
    hit_rate_percent: 80,
  },
  buildkit: {
    build_record_count: 1,
    completed_steps: 100,
    cached_steps: 80,
    cache_hit_rate_percent: 80,
    cache_export: {
      attempts: 0,
      completed: 0,
      bytes: 0,
      duration_ms: 0,
      incomplete_failures: 0,
    },
    measurement: "buildx_target_record_steps",
  },
  buildkit_records: [],
  collection: { complete: true, warnings: [], failures: [] },
  ...overrides,
});

void test("passes warm no-export Docker jobs while sccache remains writable", () => {
  const model = new PrCacheHealth({ minimumBuildkitHitRate: 20 }).evaluate({
    jobs: [
      { id: "verify", result: "success", buildExpected: true, readOnly: true },
    ],
    telemetry: [telemetry("verify")],
  });
  assert.equal(model.gate.verdict, "pass");
  assert.deepEqual(model.gate.reasons, []);
  assert.match(
    PrCacheHealth.renderMarkdown(model),
    /80 cached \/ 100 completed/,
  );
});

void test("does not require removed registry pre-probes when BuildKit telemetry is present", () => {
  const model = new PrCacheHealth({ minimumBuildkitHitRate: 20 }).evaluate({
    jobs: [
      { id: "rust", result: "success", buildExpected: true, readOnly: false },
    ],
    telemetry: [
      telemetry("rust", {
        cache_scope: {
          ...telemetry("rust").cache_scope,
          imports: {
            probes_complete: false,
            failure_class: "none",
            availability: [],
          },
        },
      }),
    ],
  });

  assert.equal(model.gate.verdict, "pass");
  assert.deepEqual(model.gate.reasons, []);
});

void test("fails missing telemetry, failed jobs, broken collection, and read-only exports", () => {
  const broken = telemetry("rust", {
    collection: {
      complete: false,
      warnings: ["logs unavailable"],
      failures: [],
    },
    buildkit: {
      build_record_count: 1,
      completed_steps: 20,
      cached_steps: 0,
      cache_hit_rate_percent: 0,
      cache_export: {
        attempts: 1,
        completed: 1,
        bytes: 20,
        duration_ms: 2,
        incomplete_failures: 0,
      },
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
  const model = new PrCacheHealth({
    minimumBuildkitHitRate: 20,
    minimumCompletedSteps: 20,
  }).evaluate({
    jobs: [
      { id: "wasm", result: "success", buildExpected: false, readOnly: true },
      { id: "verify", result: "success", buildExpected: true, readOnly: true },
    ],
    telemetry: [
      telemetry("wasm", {
        buildkit: {
          build_record_count: 0,
          completed_steps: 0,
          cached_steps: 0,
          cache_export: {
            attempts: 0,
            completed: 0,
            bytes: 0,
            duration_ms: 0,
            incomplete_failures: 0,
          },
          measurement: "buildx_target_record_steps",
        },
      }),
      telemetry("verify", {
        buildkit: {
          ...telemetry("verify").buildkit,
          completed_steps: 10,
          cached_steps: 0,
          cache_hit_rate_percent: 0,
        },
      }),
    ],
  });
  assert.equal(model.gate.verdict, "pass");
  assert.ok(model.warnings.includes("wasm:build_not_expected"));
  assert.ok(model.warnings.includes("verify:cache_sample_too_small:10<20"));
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

void test("reads telemetry recursively without relying on nonportable Dirent paths", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nook-cache-health-"),
  );
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

void test("PR workflow covers every BuildKit-producing job without another build", () => {
  const workflow = fs.readFileSync(".github/workflows/pr.yml", "utf8");
  const cacheHealthWorkflow = fs.readFileSync(
    ".github/workflows/pr-cache-health.yml",
    "utf8",
  );
  const ecosystem = fs.readFileSync(
    ".github/workflows/rust-ecosystem-checks.yml",
    "utf8",
  );
  const telemetryAction = fs.readFileSync(
    ".github/actions/nook-cache-telemetry/action.yml",
    "utf8",
  );
  assert.match(
    workflow,
    /cache-health:\n[\s\S]*needs: \[rust-ecosystem, rust, wasm, wasm-node-test, verify\]/,
  );
  assert.match(workflow, /uses: \.\/\.github\/workflows\/pr-cache-health\.yml/);
  assert.match(
    cacheHealthWorkflow,
    /node \.github\/workflows\/lib\/pr-cache-health\.mjs/,
  );
  assert.doesNotMatch(
    workflow,
    /cache-health:[\s\S]*docker buildx (?:build|bake)/,
  );
  assert.doesNotMatch(cacheHealthWorkflow, /docker buildx (?:build|bake)/);
  assert.equal(
    ecosystem.match(/uses: \.\/\.github\/actions\/nook-cache-telemetry/g)
      ?.length,
    3,
  );
  for (const result of [
    "dependency-policy-result",
    "deterministic-tests-result",
    "dylint-result",
  ]) {
    assert.match(
      workflow,
      new RegExp(
        `needs\\.rust-ecosystem\\.outputs\\.${result} \\|\\| 'cancelled'`,
      ),
    );
  }
  assert.doesNotMatch(
    workflow,
    /\{"id":"(?:dependency-policy|deterministic-tests|dylint)","result":"\$\{\{ needs\.rust-ecosystem\.result \}\}/,
  );
  assert.match(
    ecosystem,
    /dependency-policy-result:[\s\S]*jobs\.dependency-policy\.outputs\.cache-result/,
  );
  assert.match(
    ecosystem,
    /deterministic-tests-result:[\s\S]*jobs\.deterministic-tests\.outputs\.cache-result/,
  );
  assert.match(
    ecosystem,
    /dylint-result:[\s\S]*jobs\.dylint\.outputs\.cache-result/,
  );
  assert.match(telemetryAction, /NOOK_CACHE_TELEMETRY_JOB_STATUS:/);
});
