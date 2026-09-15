import { MainBuildStatsCodec } from "./main-build-stats-codecs.mjs";

/** @typedef {import("./main-build-stats.mjs").MainBuildRecord} MainBuildRecord */
/** @typedef {import("./main-build-stats.mjs").MainBuildSummary} MainBuildSummary */
/** @typedef {import("./main-build-stats.mjs").MainBuildComparison} MainBuildComparison */
/** @typedef {import("./main-build-stats.mjs").MainBuildCacheTelemetry} MainBuildCacheTelemetry */
/** @typedef {import("./main-build-stats.mjs").CacheCollectionFailure} CacheCollectionFailure */

export class LegacyMainBuildRecord {
  /** @param {unknown} record */
  constructor(record) {
    this.record = record;
  }

  /** @returns {MainBuildRecord} */
  normalize() {
    if (!this.hasRecordStructure()) {
      throw new Error("record must contain Main build sections");
    }
    const normalized = structuredClone(this.record);
    const { jobs = [] } = normalized;

    if (normalized.schema_version < 3) {
      /** @type {(keyof MainBuildSummary)[]} */
      const summaryFields = [
        "build_seconds",
        "deployment_seconds",
        "coverage_seconds",
      ];
      for (const field of summaryFields) {
        if (!Number.isFinite(normalized.summary?.[field])) {
          delete normalized.summary?.[field];
        }
      }
      /** @type {(keyof MainBuildComparison)[]} */
      const comparisonFields = [
        "wall_seconds_change_percent",
        "execution_seconds_change_percent",
        "build_seconds_change_percent",
      ];
      for (const field of comparisonFields) {
        if (!Number.isFinite(normalized.comparison?.[field])) {
          delete normalized.comparison?.[field];
        }
      }
      for (const job of jobs) {
        if (!Number.isFinite(job.duration_seconds)) delete job.duration_seconds;
        const { steps = [] } = job;
        for (const step of steps) {
          if (!Number.isFinite(step.duration_seconds)) {
            delete step.duration_seconds;
          }
        }
      }
      if (normalized.cache_telemetry) {
        this.removeUnmeasuredCacheRates(normalized.cache_telemetry);
      }
    }

    if (normalized.cache_telemetry) {
      this.normalizeCacheCollection(normalized.cache_telemetry);
      if (normalized.schema_version < 3) {
        this.normalizeSccacheSummaries(normalized.cache_telemetry);
      }
    }

    if (normalized.schema_version < 2 || !normalized.cache_telemetry) {
      return normalized;
    }

    this.renameDirectCompileBackend(normalized.cache_telemetry);
    return normalized;
  }

  /** @returns {this is LegacyMainBuildRecord & {record: MainBuildRecord}} */
  hasRecordStructure() {
    const value = this.record;
    if (!MainBuildStatsCodec.isJsonRecord(value)) return false;
    return (
      MainBuildStatsCodec.isJsonRecord(value.source_run) &&
      MainBuildStatsCodec.isJsonRecord(value.summary) &&
      MainBuildStatsCodec.isJsonRecord(value.comparison) &&
      Array.isArray(value.source_pull_requests) &&
      Array.isArray(value.jobs)
    );
  }

  /** @param {MainBuildCacheTelemetry} telemetry */
  removeUnmeasuredCacheRates(telemetry) {
    const telemetryTotals = telemetry.totals;
    const { jobs: telemetryJobs = [] } = telemetry;
    /** @type {(keyof MainBuildCacheTelemetry['totals'])[]} */
    const telemetryFields = [
      "sccache_hit_rate_percent",
      "buildkit_cache_hit_rate_percent",
    ];
    for (const field of telemetryFields) {
      if (!Number.isFinite(telemetryTotals?.[field])) {
        delete telemetryTotals?.[field];
      }
    }
    for (const job of telemetryJobs) {
      if (!Number.isFinite(job.sccache?.hit_rate_percent)) {
        delete job.sccache?.hit_rate_percent;
      }
      if (!Number.isFinite(job.buildkit?.cache_hit_rate_percent)) {
        delete job.buildkit?.cache_hit_rate_percent;
      }
    }
  }

  /** @param {MainBuildCacheTelemetry} telemetry */
  normalizeCacheCollection(telemetry) {
    const { jobs: telemetryJobs = [] } = telemetry;
    /** @type {CacheCollectionFailure[]} */
    const normalizedFailures = [];
    for (const job of telemetryJobs) {
      const jobFailures = job.collection?.failures;
      if (!Array.isArray(jobFailures)) {
        job.collection.failures = [];
        continue;
      }
      normalizedFailures.push(...jobFailures);
    }
    telemetry.collection.complete =
      telemetryJobs.length > 0 &&
      telemetryJobs.every((job) => job.collection.complete);
    telemetry.collection.warnings =
      telemetryJobs.length === 0
        ? ["cache_telemetry_artifact_unavailable"]
        : telemetryJobs.flatMap((job) => job.collection.warnings);
    telemetry.collection.failures = normalizedFailures;
    if (!telemetry.totals?.cache_export) {
      telemetry.totals.cache_export = telemetryJobs.reduce(
        (total, job) => ({
          attempts:
            total.attempts + (job.buildkit?.cache_export?.attempts || 0),
          completed:
            total.completed + (job.buildkit?.cache_export?.completed || 0),
          bytes: total.bytes + (job.buildkit?.cache_export?.bytes || 0),
          duration_ms:
            total.duration_ms + (job.buildkit?.cache_export?.duration_ms || 0),
          incomplete_failures:
            total.incomplete_failures +
            (job.buildkit?.cache_export?.incomplete_failures || 0),
        }),
        {
          attempts: 0,
          completed: 0,
          bytes: 0,
          duration_ms: 0,
          incomplete_failures: 0,
        },
      );
    }
  }

  /** @param {MainBuildCacheTelemetry} telemetry */
  normalizeSccacheSummaries(telemetry) {
    const { jobs: telemetryJobs = [] } = telemetry;
    for (const job of telemetryJobs) {
      const sccache = job.sccache;
      const reportCount =
        Number.isInteger(sccache?.report_count) && sccache.report_count >= 0
          ? sccache.report_count
          : 0;
      const available = reportCount > 0;
      job.sccache = {
        ...{
          report_count: reportCount,
          baked_runtime_mode: available ? "READ_WRITE" : "UNAVAILABLE",
          runtime_mode: available ? "READ_WRITE" : "UNAVAILABLE",
          runtime_mode_source: available ? "environment" : "unavailable",
          client_side: false,
          counter_reliability: available ? "authoritative" : "unavailable",
          publication_status: available
            ? "counters_observed"
            : "unavailable",
          compile_requests: 0,
          requests_executed: 0,
          cache_hits: 0,
          cache_misses: 0,
          cache_errors: 0,
          cache_write_errors: 0,
          cache_writes: 0,
          compile_failures: 0,
          measurement: "sum_of_zero_based_run_snapshots",
          fallback: { state: "active", reason: "none" },
          snapshots: [],
        },
        ...sccache,
        report_count: reportCount,
      };
    }
  }

  /** @param {MainBuildCacheTelemetry} telemetry */
  renameDirectCompileBackend(telemetry) {
    const totals = telemetry.totals;
    const { jobs: telemetryJobs = [] } = telemetry;
    if (
      totals &&
      !("direct_compile_job_count" in totals) &&
      "local_fallback_job_count" in totals
    ) {
      totals.direct_compile_job_count = MainBuildStatsCodec.requireInteger(
        totals.local_fallback_job_count,
        "cache_telemetry.totals.local_fallback_job_count",
      );
      delete totals.local_fallback_job_count;
    }
    for (const job of telemetryJobs) {
      if (job.cache_backend?.kind === "local_fallback") {
        job.cache_backend.kind = "direct_compile";
      }
    }
  }
}
