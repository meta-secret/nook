import { CacheTelemetry } from "./cache-telemetry.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** @typedef {Record<string, unknown>} JsonRecord */
/** @typedef {import("./cache-telemetry-contracts.mjs").SccacheReport} SccacheReport */
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

  /** @param {unknown} value @param {string} label @returns {boolean} */
  static requireBoolean(value, label) {
    if (typeof value !== "boolean") {
      throw new Error(`${label} must be a boolean`);
    }
    return value;
  }

  /** @param {unknown} value @param {string} label @returns {'READ_WRITE' | 'UNAVAILABLE'} */
  static requireSccacheMode(value, label) {
    if (value !== "READ_WRITE" && value !== "UNAVAILABLE") {
      throw new Error(`${label} must be READ_WRITE or UNAVAILABLE`);
    }
    return value;
  }

  /** @param {unknown} value @param {string} label @returns {'READ_WRITE'} */
  static requireSccacheReportMode(value, label) {
    if (value !== "READ_WRITE") {
      throw new Error(`${label} must be READ_WRITE`);
    }
    return value;
  }

  /** @param {unknown} value @param {string} label @returns {'environment' | 'runtime_secret' | 'unavailable'} */
  static requireSccacheModeSource(value, label) {
    if (
      value !== "environment" &&
      value !== "runtime_secret" &&
      value !== "unavailable"
    ) {
      throw new Error(
        `${label} must be environment, runtime_secret, or unavailable`,
      );
    }
    return value;
  }

  /** @param {unknown} value @param {string} label @returns {'environment' | 'runtime_secret'} */
  static requireSccacheReportModeSource(value, label) {
    if (value !== "environment" && value !== "runtime_secret") {
      throw new Error(`${label} must be environment or runtime_secret`);
    }
    return value;
  }

  /** @param {unknown} value @param {string} label @returns {'authoritative' | 'backend_incomplete' | 'unavailable'} */
  static requireSccacheReliability(value, label) {
    if (
      value !== "authoritative" &&
      value !== "backend_incomplete" &&
      value !== "unavailable"
    ) {
      throw new Error(
        `${label} must be authoritative, backend_incomplete, or unavailable`,
      );
    }
    return value;
  }

  /** @param {unknown} value @param {string} label @returns {'authoritative' | 'backend_incomplete'} */
  static requireSccacheReportReliability(value, label) {
    if (value !== "authoritative" && value !== "backend_incomplete") {
      throw new Error(`${label} must be authoritative or backend_incomplete`);
    }
    return value;
  }

  /** @param {unknown} value @param {string} label @returns {'pending_verification' | 'counters_observed' | 'unavailable'} */
  static requireSccachePublicationStatus(value, label) {
    if (
      value !== "pending_verification" &&
      value !== "counters_observed" &&
      value !== "unavailable"
    ) {
      throw new Error(
        `${label} must be pending_verification, counters_observed, or unavailable`,
      );
    }
    return value;
  }

  /** @param {unknown} value @param {string} label @returns {'pending_verification' | 'counters_observed'} */
  static requireSccacheReportPublicationStatus(value, label) {
    if (value !== "pending_verification" && value !== "counters_observed") {
      throw new Error(`${label} must be pending_verification or counters_observed`);
    }
    return value;
  }

  /** @param {unknown} value @param {string} label @returns {{state: 'active' | 'fallback', reason: string}} */
  static requireSccacheFallback(value, label) {
    const fallback = this.requireRecord(value, label);
    const state = fallback.state;
    if (state !== "active" && state !== "fallback") {
      throw new Error(`${label}.state must be active or fallback`);
    }
    return {
      state,
      reason: this.requireStringValue(fallback.reason, `${label}.reason`),
    };
  }

  /** @param {unknown} value @param {string} label @returns {readonly SccacheReport[]} */
  static requireSccacheSnapshots(value, label) {
    if (!Array.isArray(value)) {
      throw new Error(`${label} must be an array`);
    }
    return value.map((entry, index) => {
      const report = this.requireRecord(entry, `${label}[${index}]`);
      return {
        stage: this.requireString(report.stage, `${label}[${index}].stage`),
        baked_runtime_mode: this.requireSccacheReportMode(
          report.baked_runtime_mode,
          `${label}[${index}].baked_runtime_mode`,
        ),
        runtime_mode: this.requireSccacheReportMode(
          report.runtime_mode,
          `${label}[${index}].runtime_mode`,
        ),
        runtime_mode_source: this.requireSccacheReportModeSource(
          report.runtime_mode_source,
          `${label}[${index}].runtime_mode_source`,
        ),
        client_side: this.requireBoolean(
          report.client_side,
          `${label}[${index}].client_side`,
        ),
        counter_reliability: this.requireSccacheReportReliability(
          report.counter_reliability,
          `${label}[${index}].counter_reliability`,
        ),
        publication_status: this.requireSccacheReportPublicationStatus(
          report.publication_status,
          `${label}[${index}].publication_status`,
        ),
        compile_requests: this.requireInteger(
          report.compile_requests,
          `${label}[${index}].compile_requests`,
        ),
        requests_executed: this.requireInteger(
          report.requests_executed,
          `${label}[${index}].requests_executed`,
        ),
        cache_hits: this.requireInteger(
          report.cache_hits,
          `${label}[${index}].cache_hits`,
        ),
        cache_misses: this.requireInteger(
          report.cache_misses,
          `${label}[${index}].cache_misses`,
        ),
        cache_errors: this.requireInteger(
          report.cache_errors,
          `${label}[${index}].cache_errors`,
        ),
        cache_write_errors: this.requireInteger(
          report.cache_write_errors,
          `${label}[${index}].cache_write_errors`,
        ),
        cache_writes: this.requireInteger(
          report.cache_writes,
          `${label}[${index}].cache_writes`,
        ),
        compile_failures: this.requireInteger(
          report.compile_failures,
          `${label}[${index}].compile_failures`,
        ),
      };
    });
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
        baked_runtime_mode: this.requireSccacheMode(
          sccache.baked_runtime_mode,
          "sccache baked runtime mode",
        ),
        runtime_mode: this.requireSccacheMode(
          sccache.runtime_mode,
          "sccache runtime mode",
        ),
        runtime_mode_source: this.requireSccacheModeSource(
          sccache.runtime_mode_source,
          "sccache runtime mode source",
        ),
        client_side: this.requireBoolean(
          sccache.client_side,
          "sccache client-side mode",
        ),
        counter_reliability: this.requireSccacheReliability(
          sccache.counter_reliability,
          "sccache counter reliability",
        ),
        publication_status: this.requireSccachePublicationStatus(
          sccache.publication_status,
          "sccache publication status",
        ),
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
        fallback: this.requireSccacheFallback(
          sccache.fallback,
          "sccache fallback",
        ),
        snapshots: this.requireSccacheSnapshots(
          sccache.snapshots,
          "sccache snapshots",
        ),
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
