import { CacheTelemetry } from "./cache-telemetry.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** @typedef {Record<string, unknown>} JsonRecord */
/** @typedef {import("./cache-telemetry-contracts.mjs").SccacheSummary} SccacheSummary */
/** @typedef {{component: string, reference: string, message: string}} CacheCollectionFailure */
/** @typedef {{attempts: number, completed: number, bytes: number, duration_ms: number, incomplete_failures: number}} CacheExportSummary */
/** @typedef {{job: string, cache_backend: {kind: 'remote' | 'direct_compile', persistent: boolean, reason: string}, sccache: SccacheSummary, buildkit: {build_record_count: number, completed_steps: number, cached_steps: number, cache_hit_rate_percent?: number, cache_export?: CacheExportSummary, measurement: 'buildx_target_record_steps'}, collection: {complete: boolean, warnings: string[], failures: CacheCollectionFailure[]}}} AdmittedCacheTelemetry */

export class MainBuildStatsCodec {
  /** @this {void} @param {string} moduleUrl @param {string | undefined} argument @returns {boolean} */
  static isEntrypoint(moduleUrl, argument) {
    return (
      Boolean(argument) &&
      path.resolve(String(argument)) === fileURLToPath(moduleUrl)
    );
  }

  /** @this {void} @param {unknown} value @returns {value is JsonRecord} */
  static isJsonRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  /** @param {unknown} value @param {string} label @returns {JsonRecord} */
  static requireRecord(value, label) {
    if (!this.isJsonRecord(value)) {
      throw new Error(`${label} must be an object`);
    }
    return value;
  }

  /** @param {unknown} value @param {string} label @returns {number} */
  static requireInteger(value, label) {
    if (!Number.isInteger(value) || typeof value !== "number" || value < 0) {
      throw new Error(`${label} must be a non-negative integer`);
    }
    return value;
  }

  /** @param {unknown} value @param {string} label @returns {string} */
  static requireString(value, label) {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`${label} must be a non-empty string`);
    }
    return value;
  }

  /** @param {unknown} value @param {string} label @returns {string} */
  static requireStringValue(value, label) {
    if (typeof value !== "string") {
      throw new Error(`${label} must be a string`);
    }
    return value;
  }

  /** @param {unknown} value @param {string} label @returns {string[]} */
  static requireStrings(value, label) {
    if (
      !Array.isArray(value) ||
      !value.every((entry) => typeof entry === "string")
    ) {
      throw new Error(`${label} must be a string array`);
    }
    return value;
  }

  /** @param {string} text @returns {unknown} */
  static parseJson(text) {
    return JSON.parse(text);
  }

  /** @this {void} @param {string} _key @param {unknown} value @returns {unknown} */
  static retainJsonValue(_key, value) {
    return value;
  }

  /**
   * @param {unknown} candidate
   * @param {{runId: number, runAttempt: number}} expected
   * @returns {AdmittedCacheTelemetry}
   */
  static admitCacheTelemetry(candidate, expected) {
    const record = CacheTelemetry.validateTelemetryRecord(candidate, expected);
    const github = this.requireRecord(record.github, "cache telemetry github");
    const backend = this.requireRecord(
      record.cache_backend,
      "cache telemetry backend",
    );
    const sccache = this.requireRecord(
      record.sccache,
      "cache telemetry sccache",
    );
    const buildkit = this.requireRecord(
      record.buildkit,
      "cache telemetry buildkit",
    );
    const collection = this.requireRecord(
      record.collection,
      "cache telemetry collection",
    );
    const backendKind = this.requireString(backend.kind, "cache backend kind");
    if (backendKind !== "remote" && backendKind !== "direct_compile") {
      throw new Error("cache backend kind must be remote or direct_compile");
    }
    if (typeof backend.persistent !== "boolean") {
      throw new Error("cache backend persistent must be boolean");
    }
    if (typeof collection.complete !== "boolean") {
      throw new Error("cache collection complete must be boolean");
    }
    const failures = Array.isArray(collection.failures)
      ? collection.failures.map((candidate, index) => {
          const failure = this.requireRecord(
            candidate,
            `cache collection failure ${index}`,
          );
          return {
            component: this.requireStringValue(
              failure.component,
              `cache collection failure ${index} component`,
            ),
            reference: this.requireStringValue(
              failure.reference,
              `cache collection failure ${index} reference`,
            ),
            message: this.requireStringValue(
              failure.message,
              `cache collection failure ${index} message`,
            ),
          };
        })
      : [];
    return {
      job: this.requireString(github.job, "cache telemetry job"),
      cache_backend: {
        kind: backendKind,
        persistent: backend.persistent,
        reason: this.requireString(backend.reason, "cache backend reason"),
      },
      sccache: {
        report_count: this.requireInteger(
          sccache.report_count,
          "sccache report count",
        ),
        baked_runtime_mode: sccache.baked_runtime_mode,
        runtime_mode: sccache.runtime_mode,
        runtime_mode_source: sccache.runtime_mode_source,
        client_side: sccache.client_side,
        counter_reliability: sccache.counter_reliability,
        publication_status: sccache.publication_status,
        compile_requests: this.requireInteger(
          sccache.compile_requests,
          "sccache compile requests",
        ),
        requests_executed: this.requireInteger(
          sccache.requests_executed,
          "sccache requests executed",
        ),
        cache_hits: this.requireInteger(
          sccache.cache_hits,
          "sccache cache hits",
        ),
        cache_misses: this.requireInteger(
          sccache.cache_misses,
          "sccache cache misses",
        ),
        cache_errors: this.requireInteger(
          sccache.cache_errors,
          "sccache cache errors",
        ),
        cache_write_errors: this.requireInteger(
          sccache.cache_write_errors,
          "sccache cache write errors",
        ),
        cache_writes: this.requireInteger(
          sccache.cache_writes,
          "sccache cache writes",
        ),
        compile_failures: this.requireInteger(
          sccache.compile_failures,
          "sccache compile failures",
        ),
        measurement: "sum_of_zero_based_run_snapshots",
        fallback: {
          state: sccache.fallback.state,
          reason: sccache.fallback.reason,
        },
        snapshots: sccache.snapshots,
        ...(Number.isFinite(sccache.hit_rate_percent)
          ? { hit_rate_percent: Number(sccache.hit_rate_percent) }
          : {}),
      },
      buildkit: {
        build_record_count: this.requireInteger(
          buildkit.build_record_count,
          "buildkit record count",
        ),
        completed_steps: this.requireInteger(
          buildkit.completed_steps,
          "buildkit completed steps",
        ),
        cached_steps: this.requireInteger(
          buildkit.cached_steps,
          "buildkit cached steps",
        ),
        ...(Number.isFinite(buildkit.cache_hit_rate_percent)
          ? { cache_hit_rate_percent: Number(buildkit.cache_hit_rate_percent) }
          : {}),
        ...(this.isJsonRecord(buildkit.cache_export)
          ? {
              cache_export: {
                attempts: this.requireInteger(
                  buildkit.cache_export.attempts,
                  "cache export attempts",
                ),
                completed: this.requireInteger(
                  buildkit.cache_export.completed,
                  "cache export completed",
                ),
                bytes: this.requireInteger(
                  buildkit.cache_export.bytes,
                  "cache export bytes",
                ),
                duration_ms: this.requireInteger(
                  buildkit.cache_export.duration_ms,
                  "cache export duration",
                ),
                incomplete_failures: this.requireInteger(
                  buildkit.cache_export.incomplete_failures,
                  "cache export incomplete failures",
                ),
              },
            }
          : {}),
        measurement: "buildx_target_record_steps",
      },
      collection: {
        complete: collection.complete,
        warnings: this.requireStrings(
          collection.warnings,
          "cache collection warnings",
        ),
        failures,
      },
    };
  }
}
