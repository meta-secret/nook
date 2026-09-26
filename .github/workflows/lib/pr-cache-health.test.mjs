import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PrCacheHealth, SccacheExpectation } from "./pr-cache-health.mjs";
import {
  CompilePhaseCacheExportMode,
  CompilePhaseStatus,
} from "./cache-scope-telemetry.mjs";

/** @typedef {import("./cache-telemetry-contracts.mjs").CacheTelemetryRecord} CacheTelemetryRecord */

/** @param {string} job @param {Record<string, unknown>} [overrides] @returns {CacheTelemetryRecord} */
const telemetry = (job, overrides = {}) => ({
  schema_version: 2,
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
      parent_scope_suffix: "",
      parent_ref: "",
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
      probes_complete: true,
      failure_class: "none",
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
    remote_writes: 2,
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
      byte_measurement: {
        status: "unavailable",
        reason: "buildkit_did_not_emit_byte_count",
      },
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
      {
        id: "verify",
        result: "success",
        buildExpected: true,
        sccacheExpectation: SccacheExpectation.NotRequired,
        readOnly: true,
      },
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

void test("does not require sccache telemetry for compiler-free BuildKit jobs", () => {
  const compilerFree = telemetry("dependency-policy", {
    cache_backend: {
      kind: "direct_compile",
      persistent: false,
      reason: "no_compiler_invocations",
    },
    sccache: {
      report_count: 0,
      baked_runtime_mode: "UNAVAILABLE",
      runtime_mode: "UNAVAILABLE",
      runtime_mode_source: "unavailable",
      client_side: false,
      counter_reliability: "unavailable",
      publication_status: "unavailable",
      compile_requests: 0,
      requests_executed: 0,
      cache_hits: 0,
      cache_misses: 0,
      cache_errors: 0,
      cache_write_errors: 0,
      cache_writes: 0,
      remote_writes: 0,
      compile_failures: 0,
      measurement: "sum_of_zero_based_run_snapshots",
      fallback: { state: "active", reason: "none" },
      snapshots: [],
    },
  });
  const model = new PrCacheHealth().evaluate({
    jobs: [
      {
        id: "dependency-policy",
        result: "success",
        buildExpected: true,
        sccacheExpectation: SccacheExpectation.NotRequired,
        readOnly: false,
      },
    ],
    telemetry: [compilerFree],
  });

  assert.equal(model.gate.verdict, "pass");
  assert.deepEqual(model.gate.reasons, []);
});

void test("requires a named sccache expectation at the workflow boundary", () => {
  const jobs = PrCacheHealth.parseJobs(
    JSON.stringify([
      {
        id: "rust",
        result: "success",
        buildExpected: true,
        sccacheExpectation: SccacheExpectation.Required,
        readOnly: false,
      },
      {
        id: "dependency-policy",
        result: "success",
        buildExpected: true,
        sccacheExpectation: SccacheExpectation.NotRequired,
        readOnly: false,
      },
      {
        id: "wasm-node-test",
        result: "skipped",
        buildExpected: false,
        sccacheExpectation: SccacheExpectation.NotApplicable,
        readOnly: true,
      },
    ]),
  );

  assert.deepEqual(
    jobs.map((job) => job.sccacheExpectation),
    [
      SccacheExpectation.Required,
      SccacheExpectation.NotRequired,
      SccacheExpectation.NotApplicable,
    ],
  );
  assert.throws(
    () =>
      PrCacheHealth.parseJobs(
        JSON.stringify([
          {
            id: "rust",
            result: "success",
            buildExpected: true,
            readOnly: false,
          },
        ]),
      ),
    /cache-health jobs must be a valid job array/,
  );
  assert.throws(
    () =>
      PrCacheHealth.parseJobs(
        JSON.stringify([
          {
            id: "rust",
            result: "success",
            buildExpected: true,
            sccacheExpectation: SccacheExpectation.NotApplicable,
            readOnly: false,
          },
        ]),
      ),
    /cache-health sccache expectation is inconsistent/,
  );
});

void test("does not require removed registry pre-probes when BuildKit telemetry is present", () => {
  const model = new PrCacheHealth({ minimumBuildkitHitRate: 20 }).evaluate({
    jobs: [
      {
        id: "rust",
        result: "success",
        buildExpected: true,
        sccacheExpectation: SccacheExpectation.Required,
        readOnly: false,
      },
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
        byte_measurement: { status: "measured", bytes: 20 },
        duration_ms: 2,
        incomplete_failures: 0,
      },
      measurement: "buildx_target_record_steps",
    },
  });
  const model = new PrCacheHealth({ minimumBuildkitHitRate: 20 }).evaluate({
    jobs: [
      {
        id: "rust",
        result: "failure",
        buildExpected: true,
        sccacheExpectation: SccacheExpectation.Required,
        readOnly: true,
      },
      {
        id: "wasm",
        result: "success",
        buildExpected: true,
        sccacheExpectation: SccacheExpectation.Required,
        readOnly: true,
      },
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
      {
        id: "wasm",
        result: "success",
        buildExpected: false,
        sccacheExpectation: SccacheExpectation.NotApplicable,
        readOnly: true,
      },
      {
        id: "verify",
        result: "success",
        buildExpected: true,
        sccacheExpectation: SccacheExpectation.NotRequired,
        readOnly: true,
      },
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
            byte_measurement: {
              status: "unavailable",
              reason: "buildkit_did_not_emit_byte_count",
            },
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
      {
        id: "rust",
        result: "success",
        buildExpected: true,
        sccacheExpectation: SccacheExpectation.Required,
        readOnly: false,
      },
    ],
    telemetry: [cold],
  });
  assert.equal(model.gate.verdict, "pass");
  assert.ok(model.warnings.includes("rust:cold_cache_no_available_imports"));
  assert.ok(model.warnings.includes("rust:publication_pending_verification"));
});

void test("fails warm samples when BuildKit does not report a hit rate", () => {
  const source = telemetry("rust");
  const { cache_hit_rate_percent: omittedRate, ...buildkit } = source.buildkit;
  void omittedRate;
  const model = new PrCacheHealth().evaluate({
    jobs: [
      {
        id: "rust",
        result: "success",
        buildExpected: true,
        sccacheExpectation: SccacheExpectation.Required,
        readOnly: false,
      },
    ],
    telemetry: [telemetry("rust", { buildkit })],
  });

  assert.equal(model.gate.verdict, "fail");
  assert.ok(model.gate.reasons.includes("rust:buildkit_cache_rate_missing"));
  const result = model.jobs.at(0);
  assert.ok(result);
  assert.ok(result.counters.buildkit);
  assert.equal(
    Object.hasOwn(result.counters.buildkit, "cache_hit_rate_percent"),
    false,
  );
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
      {
        id: "rust",
        result: "success",
        buildExpected: true,
        sccacheExpectation: SccacheExpectation.Required,
        readOnly: false,
      },
    ],
    telemetry: [successor],
  });
  assert.equal(model.gate.verdict, "fail");
  assert.ok(model.gate.reasons.includes("rust:sccache_write_errors:1"));
  assert.ok(model.gate.reasons.includes("rust:sccache_next_head_zero_hits"));
  assert.ok(!model.gate.reasons.includes("rust:telemetry_incomplete"));
});

void test("requires remote write evidence only when compiler misses occur", () => {
  const missWithoutWrite = telemetry("rust", {
    sccache: {
      ...telemetry("rust").sccache,
      client_side: false,
      counter_reliability: "authoritative",
      publication_status: "counters_observed",
      cache_hits: 0,
      cache_misses: 2,
      cache_writes: 0,
      remote_writes: 0,
    },
  });
  const missModel = new PrCacheHealth().evaluate({
    jobs: [
      {
        id: "rust",
        result: "success",
        buildExpected: true,
        sccacheExpectation: SccacheExpectation.Required,
        readOnly: false,
      },
    ],
    telemetry: [missWithoutWrite],
  });
  assert.equal(missModel.gate.verdict, "fail");
  assert.ok(
    missModel.gate.reasons.includes("rust:sccache_remote_writes_missing"),
  );

  const fullyCached = telemetry("rust", {
    sccache: {
      ...telemetry("rust").sccache,
      cache_hits: 2,
      cache_misses: 0,
      cache_writes: 0,
      remote_writes: 0,
    },
  });
  const cachedModel = new PrCacheHealth().evaluate({
    jobs: [
      {
        id: "rust",
        result: "success",
        buildExpected: true,
        sccacheExpectation: SccacheExpectation.Required,
        readOnly: true,
      },
    ],
    telemetry: [fullyCached],
  });
  assert.equal(cachedModel.gate.verdict, "pass");
});

void test("defers incomplete client-side writes but keeps changed-head zero hits terminal", () => {
  const pending = telemetry("rust", {
    sccache: {
      ...telemetry("rust").sccache,
      client_side: true,
      counter_reliability: "backend_incomplete",
      publication_status: "pending_verification",
      cache_hits: 0,
      cache_misses: 2,
      cache_writes: 0,
      remote_writes: 0,
    },
  });
  const coldPending = telemetry("rust", {
    sccache: pending.sccache,
    buildkit: {
      ...pending.buildkit,
      cached_steps: 0,
      cache_hit_rate_percent: 0,
    },
    cache_scope: {
      ...pending.cache_scope,
      imports: {
        probes_complete: true,
        failure_class: "none",
        availability: [
          { name: "GHA_CACHE_EXACT_RUST_BASE_AVAILABLE", available: false },
        ],
      },
    },
  });
  const coldModel = new PrCacheHealth().evaluate({
    jobs: [
      {
        id: "rust",
        result: "success",
        buildExpected: true,
        sccacheExpectation: SccacheExpectation.Required,
        readOnly: false,
      },
    ],
    telemetry: [coldPending],
  });

  assert.equal(coldModel.gate.verdict, "pass");
  assert.ok(
    coldModel.warnings.includes("rust:publication_pending_verification"),
  );
  assert.ok(
    !coldModel.gate.reasons.includes("rust:sccache_remote_writes_missing"),
  );

  const changedHeadModel = new PrCacheHealth().evaluate({
    jobs: [
      {
        id: "rust",
        result: "success",
        buildExpected: true,
        sccacheExpectation: SccacheExpectation.Required,
        readOnly: false,
      },
    ],
    telemetry: [pending],
  });

  assert.equal(changedHeadModel.gate.verdict, "fail");
  assert.ok(
    changedHeadModel.gate.reasons.includes("rust:sccache_next_head_zero_hits"),
  );
  assert.ok(
    !changedHeadModel.gate.reasons.includes(
      "rust:sccache_remote_writes_missing",
    ),
  );
});

void test("fails compiler-bearing WASM Node jobs with unavailable sccache or fallback telemetry", () => {
  const unavailable = telemetry("wasm-node-test", {
    cache_backend: {
      kind: "direct_compile",
      persistent: false,
      reason: "credentials_unavailable",
    },
    sccache: {
      report_count: 0,
      baked_runtime_mode: "UNAVAILABLE",
      runtime_mode: "UNAVAILABLE",
      runtime_mode_source: "unavailable",
      client_side: false,
      counter_reliability: "unavailable",
      publication_status: "unavailable",
      compile_requests: 0,
      requests_executed: 0,
      cache_hits: 0,
      cache_misses: 0,
      cache_errors: 0,
      cache_write_errors: 0,
      cache_writes: 0,
      remote_writes: 0,
      compile_failures: 0,
      measurement: "sum_of_zero_based_run_snapshots",
      fallback: { state: "fallback", reason: "credentials_unavailable" },
      snapshots: [],
    },
  });
  const model = new PrCacheHealth().evaluate({
    jobs: [
      {
        id: "wasm-node-test",
        result: "success",
        buildExpected: true,
        sccacheExpectation: SccacheExpectation.Required,
        readOnly: false,
      },
    ],
    telemetry: [unavailable],
  });

  assert.equal(model.gate.verdict, "fail");
  assert.ok(model.gate.reasons.includes("wasm-node-test:sccache_unavailable"));
  assert.ok(
    model.gate.reasons.includes(
      "wasm-node-test:sccache_fallback:credentials_unavailable",
    ),
  );
});

void test("does not require sccache for the web-only verification job", () => {
  const webOnly = telemetry("verify", {
    cache_backend: {
      kind: "direct_compile",
      persistent: false,
      reason: "credentials_unavailable",
    },
    sccache: {
      report_count: 0,
      baked_runtime_mode: "UNAVAILABLE",
      runtime_mode: "UNAVAILABLE",
      runtime_mode_source: "unavailable",
      client_side: false,
      counter_reliability: "unavailable",
      publication_status: "unavailable",
      compile_requests: 0,
      requests_executed: 0,
      cache_hits: 0,
      cache_misses: 0,
      cache_errors: 0,
      cache_write_errors: 0,
      cache_writes: 0,
      remote_writes: 0,
      compile_failures: 0,
      measurement: "sum_of_zero_based_run_snapshots",
      fallback: { state: "active", reason: "none" },
      snapshots: [],
    },
  });
  const model = new PrCacheHealth().evaluate({
    jobs: [
      {
        id: "verify",
        result: "success",
        buildExpected: true,
        sccacheExpectation: SccacheExpectation.NotRequired,
        readOnly: false,
      },
    ],
    telemetry: [webOnly],
  });

  assert.equal(model.gate.verdict, "pass");
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

void test("one PR job avoids telemetry and registry handoffs", () => {
  const workflow = fs.readFileSync(".github/workflows/pr.yml", "utf8");
  const arcRunnerDockerfile = fs.readFileSync(
    "infra/k0s/images/arc-runner/Dockerfile",
    "utf8",
  );
  const arcRunnerBake = fs.readFileSync(
    "infra/k0s/images/arc-runner/docker-bake.hcl",
    "utf8",
  );
  const arcRunnerPatch = fs.readFileSync(
    "infra/k0s/images/arc-runner/runner-container-hooks-v0.8.1.patch",
    "utf8",
  );
  const arcRunnerValues = fs.readFileSync(
    "infra/k0s/manifests/arc/container-runner-scale-set-values.yaml",
    "utf8",
  );
  const arcContainerHook = fs.readFileSync(
    "infra/k0s/manifests/arc/container-hook.yaml",
    "utf8",
  );
  assert.equal(workflow.match(/^[ ]{4}runs-on:/gm)?.length, 1);
  const rootWorkflow = fs.readFileSync(".github/workflows/ci.yml", "utf8");
  assert.match(
    rootWorkflow,
    /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/,
  );
  assert.match(arcRunnerDockerfile, /FROM ghcr\.io\/actions\/actions-runner:2\.336\.0@sha256:/);
  assert.match(arcRunnerDockerfile, /FROM arc-runner AS proof/);
  assert.match(arcRunnerBake, /target "arc-runner-hooks-proof"/);
  assert.match(arcRunnerPatch, /Synchronizing repository actions/);
  assert.match(arcRunnerPatch, /Synchronizing downloaded action/);
  assert.match(arcRunnerPatch, /execCpToPod/);
  assert.match(arcRunnerPatch, /`\$\{args\.workingDirectory\}\/\.github`/);
  assert.match(
    arcRunnerValues,
    /image: ghcr\.io\/meta-secret\/nook-arc-runner@sha256:[0-9a-f]{64}/,
  );
  assert.match(arcContainerHook, /mountPath: \/home\/runner\/_work/);
  assert.match(workflow, /safe\.directory "\$GITHUB_WORKSPACE"/);
  assert.doesNotMatch(
    workflow,
    /uses: \.\/\.github\/actions\/nook-cache-telemetry/,
  );
  assert.doesNotMatch(workflow, /pr-cache-health\.mjs/);
  assert.match(workflow, /preinstalled-tooling: "true"/);
  assert.doesNotMatch(
    workflow,
    /type=registry|actions\/download-artifact|needs\.rust/,
  );
  for (const credential of [
    "NOOK_SCCACHE_ACCESS_KEY",
    "NOOK_SCCACHE_SECRET_KEY",
    "NOOK_SCCACHE_ENDPOINT",
    "NOOK_SCCACHE_BUCKET",
  ]) {
    assert.ok(workflow.includes(credential));
  }
  assert.match(workflow, /require-sccache: "true"/);
});

void test(
  "failed FULL_E2E PR validation preserves only extension Playwright diagnostics",
  () => {
    const workflow = fs.readFileSync(".github/workflows/pr.yml", "utf8");
    const stepStart = workflow.indexOf(
      "      - name: Preserve failed extension Playwright diagnostics\n",
    );
    assert.notEqual(stepStart, -1);
    const nextStep = workflow.indexOf("\n      - name:", stepStart + 1);
    const step = workflow.slice(
      stepStart,
      nextStep === -1 ? workflow.length : nextStep,
    );
    const validationStart = workflow.indexOf(
      "      - name: Parallel validation and browser tests\n",
    );
    assert.notEqual(validationStart, -1);
    const validationNextStep = workflow.indexOf(
      "\n      - name:",
      validationStart + 1,
    );
    const validationStep = workflow.slice(
      validationStart,
      validationNextStep === -1 ? workflow.length : validationNextStep,
    );

    assert.match(
      step,
      /^ {8}if: failure\(\) && inputs\.full_e2e_requested$/m,
    );
    assert.match(step, /^ {8}uses: actions\/upload-artifact@v7$/m);
    assert.match(
      step,
      / {10}name: pr-extension-playwright-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/,
    );
    const pathBlock = step.match(
      / {8}with:\n {10}name: [^\n]+\n {10}path: \|\n((?: {12}[^\n]+\n)+) {10}if-no-files-found: warn\n {10}retention-days: 15(?:\n|$)/,
    );
    const pathEntries = pathBlock?.[1];
    assert.ok(pathEntries);
    assert.deepEqual(pathEntries.trimEnd().split("\n"), [
      "            ${{ runner.temp }}/nook-pr-artifacts/runtime/nook-app/nook-web/nook-web-extension/test-results/**/trace.zip",
      "            ${{ runner.temp }}/nook-pr-artifacts/runtime/nook-app/nook-web/nook-web-extension/test-results/**/error-context.md",
    ]);
    assert.match(
      validationStep,
      /^ {8}run: task --silent ci:pr:validate$/m,
    );
    assert.doesNotMatch(validationStep, /^ {8}continue-on-error:/m);
    assert.equal(
      workflow.match(/^ {8}uses: actions\/upload-artifact@v7$/gm)?.length,
      1,
    );
  },
);

void test("warm local BuildKit keeps the zero-hit compiler gate without registry imports", () => {
  const record = telemetry("validation", {
    cache_scope: {
      ...telemetry("validation").cache_scope,
      imports: { probes_complete: true, availability: [] },
    },
    sccache: {
      ...telemetry("validation").sccache,
      publication_status: "pending_verification",
      cache_hits: 0,
    },
  });
  const model = new PrCacheHealth().evaluate({
    jobs: [
      {
        id: "validation",
        result: "success",
        buildExpected: true,
        sccacheExpectation: SccacheExpectation.Required,
        readOnly: true,
      },
    ],
    telemetry: [record],
  });
  assert.equal(model.gate.verdict, "fail");
  assert.ok(
    model.gate.reasons.includes("validation:sccache_next_head_zero_hits"),
  );
});
