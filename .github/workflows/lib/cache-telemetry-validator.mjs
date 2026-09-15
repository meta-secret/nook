/** Owns admission of cache telemetry received from workflow artifacts. */
export class CacheTelemetryValidator {
  /** @param {unknown} value @returns {value is Record<string, unknown>} */
  isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  /**
   * @param {unknown} record
   * @param {{runId?: string | number, runAttempt?: string | number}} expected
   * @returns {Record<string, unknown>}
   */
  validate(record, expected = {}) {
    if (!this.isRecord(record)) throw new Error("telemetry record is required");
    if (record.schema_version !== 1)
      throw new Error("telemetry schema_version must be 1");
    const github = record.github;
    if (!this.isRecord(github))
      throw new Error("telemetry github context is required");
    if (typeof github.run_id !== "string")
      throw new Error("telemetry github.run_id must be a string");
    if (
      !Number.isInteger(github.run_attempt) ||
      typeof github.run_attempt !== "number" ||
      github.run_attempt < 1
    )
      throw new Error(
        "telemetry github.run_attempt must be a positive integer",
      );
    if (typeof github.job !== "string" || !github.job)
      throw new Error("telemetry github.job must be a non-empty string");
    if ("runId" in expected && github.run_id !== String(expected.runId))
      throw new Error(
        `telemetry run ${github.run_id} does not match expected run ${expected.runId}`,
      );
    if (
      "runAttempt" in expected &&
      github.run_attempt !== Number(expected.runAttempt)
    )
      throw new Error(
        `telemetry attempt ${github.run_attempt} does not match expected attempt ${expected.runAttempt}`,
      );

    this.validateBackend(record.cache_backend);
    this.validateSccache(record.sccache);
    this.validateBuildkit(record.buildkit);
    this.validateCollection(record.collection);
    return record;
  }

  /** @param {unknown} candidate */
  validateBackend(candidate) {
    if (
      !this.isRecord(candidate) ||
      (candidate.kind !== "remote" && candidate.kind !== "direct_compile")
    )
      throw new Error("telemetry cache_backend.kind is invalid");
    if (typeof candidate.persistent !== "boolean")
      throw new Error("telemetry cache_backend.persistent must be boolean");
    if (candidate.persistent !== (candidate.kind === "remote"))
      throw new Error("telemetry cache backend persistence is inconsistent");
    if (typeof candidate.reason !== "string" || !candidate.reason)
      throw new Error("telemetry cache_backend.reason is required");
  }

  /** @param {unknown} candidate */
  validateSccache(candidate) {
    if (!this.isRecord(candidate))
      throw new Error("telemetry sccache summary is required");
    const available =
      typeof candidate.report_count === "number" && candidate.report_count > 0;
    this.validateClosedFields(candidate, {
      baked_runtime_mode: available ? ["READ_WRITE"] : ["UNAVAILABLE"],
      runtime_mode: available ? ["READ_WRITE"] : ["UNAVAILABLE"],
      runtime_mode_source: available
        ? ["environment", "runtime_secret"]
        : ["unavailable"],
      counter_reliability: available
        ? ["authoritative", "backend_incomplete"]
        : ["unavailable"],
      publication_status: available
        ? ["pending_verification", "counters_observed"]
        : ["unavailable"],
    });
    if (typeof candidate.client_side !== "boolean")
      throw new Error("telemetry sccache.client_side is invalid");
    this.validateCounters("sccache", candidate, [
      "report_count",
      "compile_requests",
      "requests_executed",
      "cache_hits",
      "cache_misses",
      "cache_errors",
      "cache_write_errors",
      "cache_writes",
      "compile_failures",
    ]);
    this.validateOptionalRate(candidate, "hit_rate_percent", "sccache");
    if (candidate.measurement !== "sum_of_zero_based_run_snapshots")
      throw new Error("telemetry sccache.measurement is invalid");
    if (
      !this.isRecord(candidate.fallback) ||
      (candidate.fallback.state !== "active" &&
        candidate.fallback.state !== "fallback") ||
      typeof candidate.fallback.reason !== "string"
    )
      throw new Error("telemetry sccache.fallback is invalid");
    if (!Array.isArray(candidate.snapshots))
      throw new Error("telemetry sccache.snapshots must be an array");
  }

  /** @param {unknown} candidate */
  validateBuildkit(candidate) {
    if (!this.isRecord(candidate))
      throw new Error("telemetry buildkit summary is required");
    this.validateCounters("buildkit", candidate, [
      "build_record_count",
      "completed_steps",
      "cached_steps",
    ]);
    this.validateOptionalRate(candidate, "cache_hit_rate_percent", "buildkit");
    if (!("cache_export" in candidate)) return;
    const cacheExport = candidate.cache_export;
    if (!this.isRecord(cacheExport))
      throw new Error("telemetry buildkit.cache_export must be an object");
    this.validateCounters("buildkit.cache_export", cacheExport, [
      "attempts",
      "completed",
      "bytes",
      "duration_ms",
      "incomplete_failures",
    ]);
  }

  /** @param {unknown} candidate */
  validateCollection(candidate) {
    if (!this.isRecord(candidate) || typeof candidate.complete !== "boolean")
      throw new Error("telemetry collection status is required");
    if (
      !Array.isArray(candidate.warnings) ||
      !candidate.warnings.every((warning) => typeof warning === "string")
    )
      throw new Error("telemetry collection.warnings must be an array");
    if (
      "failures" in candidate &&
      (!Array.isArray(candidate.failures) ||
        !candidate.failures.every(
          (failure) =>
            this.isRecord(failure) &&
            typeof failure.component === "string" &&
            typeof failure.reference === "string" &&
            typeof failure.message === "string",
        ))
    )
      throw new Error("telemetry collection.failures must be an array");
  }

  /**
   * @param {Record<string, unknown>} record
   * @param {Record<string, readonly string[]>} fields
   */
  validateClosedFields(record, fields) {
    for (const [field, allowed] of Object.entries(fields)) {
      const value = record[field];
      if (typeof value !== "string" || !allowed.includes(value))
        throw new Error(`telemetry sccache.${field} is invalid`);
    }
  }

  /**
   * @param {string} owner
   * @param {Record<string, unknown>} record
   * @param {readonly string[]} fields
   */
  validateCounters(owner, record, fields) {
    for (const field of fields) {
      const value = record[field];
      if (!Number.isInteger(value) || typeof value !== "number" || value < 0)
        throw new Error(
          `telemetry ${owner}.${field} must be a non-negative integer`,
        );
    }
  }

  /**
   * @param {Record<string, unknown>} summary
   * @param {string} field
   * @param {string} label
   */
  validateOptionalRate(summary, field, label) {
    if (!(field in summary)) return;
    const rate = summary[field];
    if (typeof rate !== "number" || !Number.isFinite(rate))
      throw new Error(
        `telemetry ${label} cache rate must be numeric when present`,
      );
    if (rate < 0 || rate > 100)
      throw new Error(
        `telemetry ${label} cache rate must be 0..100 when measured`,
      );
  }
}
