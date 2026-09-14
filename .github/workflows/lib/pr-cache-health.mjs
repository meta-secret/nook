import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CacheTelemetry } from "./cache-telemetry.mjs";

/**
 * @typedef {object} PrCacheJob
 * @property {string} id
 * @property {string} result
 * @property {boolean} buildExpected
 * @property {boolean} readOnly
 */
/**
 * @typedef {object} CacheTelemetryRecord
 * @property {{job: string}} github
 * @property {{persistent: boolean}} cache_backend
 * @property {{imports?: {probes_complete: boolean, failure_class?: string, availability: Array<{available: boolean}>}}} cache_scope
 * @property {{cache_errors: number, cache_writes: number, cache_hits: number, cache_misses: number}} sccache
 * @property {{build_record_count: number, completed_steps: number, cached_steps: number, cache_hit_rate_percent: number, cache_export: {attempts: number, duration_ms: number, incomplete_failures: number}}} buildkit
 * @property {{complete: boolean}} collection
 */
/**
 * @typedef {object} PrCacheHealthModel
 * @property {1} schema_version
 * @property {{minimum_buildkit_hit_rate_percent: number, minimum_completed_steps: number}} policy
 * @property {Array<PrCacheJob & {telemetry_complete: boolean, counters: {sccache?: CacheTelemetryRecord["sccache"], buildkit?: {records: number, completed_steps: number, cached_steps: number, cache_hit_rate_percent: number}}, scopes: object, timing: object, imports: object, exports: {attempts?: number}, collection?: CacheTelemetryRecord["collection"]}>} jobs
 * @property {string[]} warnings
 * @property {{verdict: "pass" | "fail", specialist_activation_required: boolean, reasons: string[]}} gate
 */

export class PrCacheHealth {
  /**
   * @param {{minimumBuildkitHitRate?: number, minimumCompletedSteps?: number}} [policy]
   */
  constructor({ minimumBuildkitHitRate = 20, minimumCompletedSteps = 20 } = {}) {
    this.minimumBuildkitHitRate = minimumBuildkitHitRate;
    this.minimumCompletedSteps = minimumCompletedSteps;
  }

  /**
   * @param {{jobs: PrCacheJob[], telemetry: CacheTelemetryRecord[]}} request
   * @returns {PrCacheHealthModel}
   */
  evaluate({ jobs, telemetry }) {
    const recordsByJob = new Map(
      telemetry.map((record) => [record.github.job, record]),
    );
    /** @type {string[]} */
    const reasons = [];
    /** @type {string[]} */
    const warnings = [];
    const results = jobs.map((job) => {
      const record = recordsByJob.get(job.id);
      if (job.result !== "success")
        reasons.push(`${job.id}:upstream_failure_or_timeout`);
      if (!record) {
        if (job.buildExpected) reasons.push(`${job.id}:telemetry_missing`);
        else warnings.push(`${job.id}:telemetry_not_expected`);
        return {
          ...job,
          telemetry_complete: false,
          counters: {},
          scopes: {},
          timing: {},
          imports: {},
          exports: {},
        };
      }
      CacheTelemetry.validateTelemetryRecord(record);
      if (!record.collection.complete)
        reasons.push(`${job.id}:telemetry_incomplete`);
      if (
        job.buildExpected &&
        record.cache_backend.persistent &&
        record.cache_scope.imports?.probes_complete === false
      ) {
        reasons.push(`${job.id}:cache_import_probes_incomplete`);
      }
      if (record.sccache.cache_errors > 0)
        reasons.push(
          `${job.id}:sccache_errors:${record.sccache.cache_errors}`,
        );
      if (record.buildkit.cache_export.incomplete_failures > 0)
        reasons.push(`${job.id}:cache_export_incomplete`);
      if (job.readOnly && record.buildkit.cache_export.attempts > 0)
        reasons.push(`${job.id}:unexpected_read_only_export`);
      if (job.readOnly && record.sccache.cache_writes > 0)
        reasons.push(`${job.id}:unexpected_read_only_sccache_writes`);
      if (job.buildExpected && record.buildkit.build_record_count === 0)
        reasons.push(`${job.id}:buildkit_telemetry_missing`);
      if (!job.buildExpected) warnings.push(`${job.id}:build_not_expected`);
      const steps = record.buildkit.completed_steps;
      const imports = record.cache_scope.imports || {
        probes_complete: false,
        availability: [],
      };
      const hasAvailableImport = imports.availability.some(
        (candidate) => candidate.available,
      );
      if (job.buildExpected && steps > 0 && steps < this.minimumCompletedSteps) {
        warnings.push(
          `${job.id}:cache_sample_too_small:${steps}<${this.minimumCompletedSteps}`,
        );
      }
      if (
        job.buildExpected &&
        steps >= this.minimumCompletedSteps &&
        !hasAvailableImport
      ) {
        warnings.push(`${job.id}:cold_cache_no_available_imports`);
      }
      if (
        job.buildExpected &&
        steps >= this.minimumCompletedSteps &&
        hasAvailableImport &&
        record.buildkit.cache_hit_rate_percent < this.minimumBuildkitHitRate
      )
        reasons.push(
          `${job.id}:buildkit_cache_regression:${record.buildkit.cache_hit_rate_percent}<${this.minimumBuildkitHitRate}`,
        );
      return {
        ...job,
        telemetry_complete: record.collection.complete,
        counters: {
          sccache: record.sccache,
          buildkit: {
            records: record.buildkit.build_record_count,
            completed_steps: steps,
            cached_steps: record.buildkit.cached_steps,
            cache_hit_rate_percent: record.buildkit.cache_hit_rate_percent,
          },
        },
        scopes: record.cache_scope,
        timing: { cache_export_ms: record.buildkit.cache_export.duration_ms },
        imports,
        exports: record.buildkit.cache_export,
        collection: record.collection,
      };
    });
    return {
      schema_version: 1,
      policy: {
        minimum_buildkit_hit_rate_percent: this.minimumBuildkitHitRate,
        minimum_completed_steps: this.minimumCompletedSteps,
      },
      jobs: results,
      warnings,
      gate: {
        verdict: reasons.length === 0 ? "pass" : "fail",
        specialist_activation_required: reasons.length > 0,
        reasons,
      },
    };
  }

  /** @param {PrCacheHealthModel} model */
  static renderMarkdown(model) {
    const lines = [
      "### PR Docker cache health",
      "",
      `- Verdict: **${model.gate.verdict.toUpperCase()}**`,
      `- Docker Cache Specialist activation: **${model.gate.specialist_activation_required ? "required" : "not required"}**`,
      `- Policy: at least ${model.policy.minimum_buildkit_hit_rate_percent}% BuildKit reuse for samples with ${model.policy.minimum_completed_steps}+ completed steps`,
      "",
      "| Job | Result | Telemetry | BuildKit | sccache | Exports |",
      "| --- | --- | --- | ---: | ---: | ---: |",
    ];
    for (const job of model.jobs) {
      const buildkit = /** @type {Partial<NonNullable<typeof job.counters.buildkit>>} */ (
        job.counters.buildkit || {}
      );
      const sccache = /** @type {Partial<NonNullable<typeof job.counters.sccache>>} */ (
        job.counters.sccache || {}
      );
      lines.push(
        `| ${job.id} | ${job.result} | ${job.telemetry_complete ? "complete" : "missing/incomplete"} | ${buildkit.cached_steps ?? "n/a"} cached / ${buildkit.completed_steps ?? "n/a"} completed | ${sccache.cache_hits ?? "n/a"} hits / ${(sccache.cache_hits ?? 0) + (sccache.cache_misses ?? 0)} lookups | ${job.exports.attempts ?? "n/a"} |`,
      );
    }
    if (model.gate.reasons.length)
      lines.push(
        "",
        "#### Blocking diagnostics",
        "",
        ...model.gate.reasons.map((reason) => `- \`${reason}\``),
      );
    if (model.warnings.length)
      lines.push(
        "",
        "#### Non-blocking diagnostics",
        "",
        ...model.warnings.map((warning) => `- \`${warning}\``),
      );
    return `${lines.join("\n")}\n`;
  }

  /** @param {string} directory @returns {CacheTelemetryRecord[]} */
  static readTelemetry(directory) {
    if (!fs.existsSync(directory)) return [];
    /** @type {string[]} */
    const directories = [directory];
    /** @type {CacheTelemetryRecord[]} */
    const telemetry = [];
    while (directories.length > 0) {
      const currentDirectory = directories.pop();
      if (!currentDirectory) continue;
      for (const entry of fs.readdirSync(currentDirectory, {
        withFileTypes: true,
      })) {
        const entryPath = path.join(currentDirectory, entry.name);
        if (entry.isDirectory()) directories.push(entryPath);
        else if (entry.isFile() && entry.name.endsWith(".json"))
          telemetry.push(JSON.parse(fs.readFileSync(entryPath, "utf8")));
      }
    }
    return telemetry;
  }

  static main() {
    const directory = process.env.NOOK_PR_CACHE_TELEMETRY_DIR || "";
    const output = process.env.NOOK_PR_CACHE_HEALTH_JSON || "";
    const summary = process.env.NOOK_PR_CACHE_HEALTH_MARKDOWN || "";
    const jobs = JSON.parse(process.env.NOOK_PR_CACHE_JOBS || "[]");
    if (!directory || !output || !summary)
      throw new Error("cache-health paths are required");
    const model = new PrCacheHealth().evaluate({
      jobs,
      telemetry: PrCacheHealth.readTelemetry(directory),
    });
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(model, null, 2)}\n`);
    fs.writeFileSync(summary, PrCacheHealth.renderMarkdown(model));
    if (process.env.GITHUB_STEP_SUMMARY)
      fs.appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        PrCacheHealth.renderMarkdown(model),
      );
    if (model.gate.verdict !== "pass") {
      process.stderr.write(
        `::error title=Docker cache health::Docker Cache Specialist activation required: ${model.gate.reasons.join(", ")}\n`,
      );
      process.exitCode = 1;
    }
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  PrCacheHealth.main();
