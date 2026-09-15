import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BuildkitCacheExportTelemetry } from "./buildkit-cache-export-telemetry.mjs";
import { OrderedConcurrentMapper } from "./ordered-concurrent-mapper.mjs";

export { BuildkitCacheExportTelemetry };

export class CacheScopeTelemetry {
  /** @param {NodeJS.ProcessEnv} environment */
  constructor(environment) {
    this.environment = environment;
  }

  record() {
    const cacheAvailability = Object.entries(this.environment)
      .filter(([name]) => /^GHA_CACHE_(?:EXACT|MAIN)_.+_AVAILABLE$/.test(name))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => ({ name, available: value === "1" }));
    return {
      scope: this.environment.GHA_RUST_COMPILE_DEPS_SCOPE || "",
      compile_dependencies: {
        scope: this.environment.GHA_RUST_COMPILE_DEPS_SCOPE || "",
        available: Boolean(
          this.environment.GHA_CACHE_EXACT_RUST_COMPILE_DEPS_AVAILABLE,
        ),
        write_enabled:
          !this.environment.GHA_CACHE_EXACT_RUST_COMPILE_DEPS_AVAILABLE &&
          this.environment.GHA_CACHE_WRITE_ENABLED === "1" &&
          this.environment.NOOK_COMPILE_CACHE_MODE === "publish",
        export_enabled:
          !this.environment.GHA_CACHE_EXACT_RUST_COMPILE_DEPS_AVAILABLE &&
          this.environment.GHA_CACHE_WRITE_ENABLED === "1" &&
          this.environment.NOOK_COMPILE_CACHE_MODE === "publish",
      },
      compile_source: {
        scope: this.environment.GHA_CACHE_SCOPE_SUFFIX
          ? `nook-build-compile-v3${this.environment.GHA_CACHE_SCOPE_SUFFIX}`
          : "",
        restore_scope: this.environment.GHA_BUILD_COMPILE_RESTORE_SCOPE_SUFFIX
          ? `nook-build-compile-v3${this.environment.GHA_BUILD_COMPILE_RESTORE_SCOPE_SUFFIX}`
          : "",
        available: Boolean(
          this.environment.GHA_CACHE_EXACT_BUILD_COMPILE_AVAILABLE,
        ),
        write_enabled:
          !this.environment.GHA_CACHE_EXACT_BUILD_COMPILE_AVAILABLE &&
          this.environment.GHA_CACHE_WRITE_ENABLED === "1" &&
          this.environment.NOOK_COMPILE_CACHE_MODE === "publish",
        export_enabled:
          !this.environment.GHA_CACHE_EXACT_BUILD_COMPILE_AVAILABLE &&
          this.environment.GHA_CACHE_WRITE_ENABLED === "1" &&
          this.environment.NOOK_COMPILE_CACHE_MODE === "publish",
      },
      imports: {
        probes_complete:
          this.environment.GHA_CACHE_EXACT_PROBES_COMPLETE === "1",
        failure_class:
          this.environment.GHA_CACHE_EXACT_PROBE_FAILURE_CLASS || "none",
        availability: cacheAvailability,
      },
    };
  }
}

const SCCACHE_MARKER = "NOOK_SCCACHE_STATS ";
const SCCACHE_FALLBACK_MARKER = "NOOK_SCCACHE_FALLBACK ";
const HISTORY_LOG_CONCURRENCY = 8;
const HISTORY_LOG_TIMEOUT_MS = 4_000;
const HISTORY_RECORD_LIMIT = 32;
const HistoryLogCollectionKind = Object.freeze({
  Collected: "collected",
  Unavailable: "unavailable",
});

/** @typedef {Record<string, unknown>} JsonRecord */
/**
 * @typedef {object} BuildHistoryRecord
 * @property {string} ref
 * @property {string} name
 * @property {string} status
 * @property {number} completed_steps
 * @property {number} total_steps
 * @property {number} cached_steps
 * @property {string} [started_at]
 * @property {string} [completed_at]
 * @property {number} [cache_hit_rate_percent]
 */
/**
 * @typedef {object} SccacheReport
 * @property {string} stage
 * @property {'READ_WRITE'} baked_runtime_mode
 * @property {'READ_WRITE'} runtime_mode
 * @property {'environment' | 'runtime_secret'} runtime_mode_source
 * @property {boolean} client_side
 * @property {'authoritative' | 'backend_incomplete'} counter_reliability
 * @property {'pending_verification' | 'counters_observed'} publication_status
 * @property {number} compile_requests
 * @property {number} requests_executed
 * @property {number} cache_hits
 * @property {number} cache_misses
 * @property {number} cache_errors
 * @property {number} cache_write_errors
 * @property {number} cache_writes
 * @property {number} compile_failures
 */
/**
 * @typedef {object} SccacheSummary
 * @property {number} report_count
 * @property {'READ_WRITE' | 'UNAVAILABLE'} baked_runtime_mode
 * @property {'READ_WRITE' | 'UNAVAILABLE'} runtime_mode
 * @property {'environment' | 'runtime_secret' | 'unavailable'} runtime_mode_source
 * @property {boolean} client_side
 * @property {'authoritative' | 'backend_incomplete' | 'unavailable'} counter_reliability
 * @property {'pending_verification' | 'counters_observed' | 'unavailable'} publication_status
 * @property {number} compile_requests
 * @property {number} requests_executed
 * @property {number} cache_hits
 * @property {number} cache_misses
 * @property {number} cache_errors
 * @property {number} cache_write_errors
 * @property {number} cache_writes
 * @property {number} compile_failures
 * @property {'sum_of_per_stage_terminal_snapshots'} measurement
 * @property {{state: 'active' | 'fallback', reason: string}} fallback
 * @property {readonly SccacheReport[]} snapshots
 * @property {number} [hit_rate_percent]
 */
/**
 * @typedef {object} BuildkitSummary
 * @property {number} build_record_count
 * @property {number} completed_steps
 * @property {number} cached_steps
 * @property {number} [cache_hit_rate_percent]
 * @property {{attempts: number, completed: number, bytes: number, duration_ms: number, incomplete_failures: number}} cache_export
 * @property {'buildx_target_record_steps'} measurement
 */
/**
 * @typedef {object} CacheBackend
 * @property {'remote' | 'direct_compile'} kind
 * @property {boolean} persistent
 * @property {string} reason
 */
/**
 * @typedef {object} CacheTelemetryRecord
 * @property {1} schema_version
 * @property {{run_id: string, run_attempt: number, job: string}} github
 * @property {CacheBackend} cache_backend
 * @property {{scope: string, compile_dependencies: {scope: string, available: boolean, write_enabled: boolean, export_enabled: boolean}, compile_source: {scope: string, restore_scope: string, available: boolean, write_enabled: boolean, export_enabled: boolean}, imports: {probes_complete: boolean, failure_class: string, availability: Array<{name: string, available: boolean}>}}} cache_scope
 * @property {SccacheSummary} sccache
 * @property {BuildkitSummary} buildkit
 * @property {readonly BuildHistoryRecord[]} buildkit_records
 * @property {{complete: boolean, warnings: readonly string[], failures: readonly CollectionFailure[]}} collection
 */
/**
 * @typedef {object} CollectionFailure
 * @property {'buildx_history' | 'buildx_logs' | 'buildkit_cache_export' | 'collector'} component
 * @property {string} reference
 * @property {string} message
 */
/**
 * @typedef {object} RawJsonProgress
 * @property {readonly JsonRecord[]} objects
 * @property {readonly string[]} diagnostics
 */
/**
 * @typedef {object} TelemetryIdentityExpectation
 * @property {string | number} [runId]
 * @property {string | number} [runAttempt]
 */
/**
 * @typedef {object} CollectTelemetryRequest
 * @property {readonly string[]} baselineRefs
 * @property {readonly string[]} [baselineWarnings]
 * @property {string} [job]
 * @property {string | number} [runId]
 * @property {string | number} [runAttempt]
 * @property {NodeJS.ProcessEnv} [environment]
 */
/**
 * @typedef {object} BuildHistoryBaseline
 * @property {readonly string[]} refs
 * @property {readonly string[]} warnings
 */
/**
 * @typedef {{kind: typeof HistoryLogCollectionKind.Collected, record: BuildHistoryRecord, events: JsonRecord[]} | {kind: typeof HistoryLogCollectionKind.Unavailable, record: BuildHistoryRecord, message: string}} HistoryLogCollection
 */
/**
 * @typedef {object} UnavailableTelemetryRequest
 * @property {string} warning
 * @property {string} [job]
 * @property {string | number} [runId]
 * @property {string | number} [runAttempt]
 * @property {NodeJS.ProcessEnv} [environment]
 */

export class CacheTelemetry {
  /** @this {void} @param {unknown} value @returns {value is JsonRecord} */
  static isJsonRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  /** @param {string} text @returns {unknown} */
  static parseJson(text) {
    return JSON.parse(text);
  }

  /** @this {void} @param {string} text @returns {JsonRecord} */
  static parseJsonRecord(text) {
    const parsed = CacheTelemetry.parseJson(text);
    if (!CacheTelemetry.isJsonRecord(parsed))
      throw new Error("expected a JSON object");
    return parsed;
  }

  /** @param {string} text @returns {BuildHistoryBaseline} */
  static parseBuildHistoryBaseline(text) {
    const parsed = CacheTelemetry.parseJsonRecord(text);
    const refs = Array.isArray(parsed.refs)
      ? parsed.refs.filter((ref) => typeof ref === "string")
      : [];
    const warnings = Array.isArray(parsed.warnings)
      ? parsed.warnings.filter((warning) => typeof warning === "string")
      : [];
    return { refs, warnings };
  }

  /** @param {unknown} value @returns {string} */
  static errorMessage(value) {
    return value instanceof Error ? value.message : String(value);
  }

  /** @this {void} @param {string} _key @param {unknown} value @returns {unknown} */
  static retainJsonValue(_key, value) {
    return value;
  }

  /** @param {string} text @returns {JsonRecord[]} */
  static parseJsonObjects(text) {
    const trimmed = text.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[")) {
      const parsed = CacheTelemetry.parseJson(trimmed);
      if (!Array.isArray(parsed)) {
        throw new Error("expected a JSON object array");
      }
      /** @type {unknown[]} */
      const candidates = parsed;
      if (
        !candidates.every((candidate) => CacheTelemetry.isJsonRecord(candidate))
      ) {
        throw new Error("expected a JSON object array");
      }
      return candidates;
    }
    return trimmed
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => CacheTelemetry.parseJsonRecord(line));
  }

  /** @param {string} text @returns {RawJsonProgress} */
  static parseRawJsonProgress(text) {
    /** @type {JsonRecord[]} */
    const objects = [];
    /** @type {string[]} */
    const diagnostics = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const parsed = CacheTelemetry.parseJson(line);
        if (Array.isArray(parsed)) {
          /** @type {unknown[]} */
          const candidates = parsed;
          if (
            candidates.every((candidate) =>
              CacheTelemetry.isJsonRecord(candidate),
            )
          ) {
            objects.push(...candidates);
          } else {
            diagnostics.push(line);
          }
        } else if (CacheTelemetry.isJsonRecord(parsed)) {
          objects.push(parsed);
        } else {
          diagnostics.push(line);
        }
      } catch {
        diagnostics.push(line);
      }
    }
    return { objects, diagnostics };
  }

  /** @param {unknown} value @param {number} [fallback] @returns {number} */
  static nonNegativeInteger(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
  }

  /**
   * @param {string} field
   * @param {number} numerator
   * @param {number} denominator
   * @returns {Record<string, number>}
   */
  static percentageField(field, numerator, denominator) {
    if (denominator === 0) return {};
    return {
      [field]: Math.round((numerator / denominator) * 10_000) / 100,
    };
  }

  /** @this {void} @param {JsonRecord} record @returns {BuildHistoryRecord} */
  static normalizeBuildRecord(record) {
    const {
      completed_steps: completedStepsRaw = record.NumCompletedSteps,
      cached_steps: cachedStepsRaw = record.NumCachedSteps,
      total_steps: totalStepsRaw = record.NumTotalSteps,
      ref: refRaw = record.Ref,
      name: nameRaw = record.Name,
      status: statusRaw = record.Status,
    } = record;
    const [ref = ""] = [refRaw];
    const [name = ""] = [nameRaw];
    const [status = ""] = [statusRaw];
    const completedSteps = CacheTelemetry.nonNegativeInteger(completedStepsRaw);
    const cachedSteps = CacheTelemetry.nonNegativeInteger(cachedStepsRaw);
    const startedAtRaw = record.created_at || record.StartedAt;
    const completedAtRaw = record.completed_at || record.CompletedAt;
    return {
      ref: String(ref),
      name: String(name),
      status: String(status).toLowerCase(),
      ...(typeof startedAtRaw === "string" && startedAtRaw
        ? { started_at: startedAtRaw }
        : {}),
      ...(typeof completedAtRaw === "string" && completedAtRaw
        ? { completed_at: completedAtRaw }
        : {}),
      completed_steps: completedSteps,
      total_steps: CacheTelemetry.nonNegativeInteger(totalStepsRaw),
      cached_steps: cachedSteps,
      ...CacheTelemetry.percentageField(
        "cache_hit_rate_percent",
        cachedSteps,
        completedSteps,
      ),
    };
  }

  /** @param {string} ref @returns {string} */
  static historyLogRef(ref) {
    const [historyRef = ""] = [String(ref).split("/").filter(Boolean).pop()];
    return historyRef;
  }

  /** @param {string} left @param {string} right @returns {number} */
  static compareStrings(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
  }

  /**
   * @param {readonly BuildHistoryRecord[]} records
   * @param {number} [limit]
   * @returns {{records: BuildHistoryRecord[], warnings: string[]}}
   */
  static selectBuildRecords(records, limit = HISTORY_RECORD_LIMIT) {
    const finalized = records
      .filter((record) => record.completed_at)
      .sort((left, right) => {
        const completed = CacheTelemetry.compareStrings(
          String(right.completed_at),
          String(left.completed_at),
        );
        if (completed !== 0) return completed;
        const started = CacheTelemetry.compareStrings(
          String(right.started_at || ""),
          String(left.started_at || ""),
        );
        if (started !== 0) return started;
        return CacheTelemetry.compareStrings(left.ref, right.ref);
      });
    const warnings = [];
    const unfinishedCount = records.length - finalized.length;
    if (unfinishedCount > 0) {
      warnings.push(`buildx_records_unfinished_skipped:${unfinishedCount}`);
    }
    if (finalized.length > limit) {
      warnings.push(`buildx_records_truncated:${limit}/${finalized.length}`);
    }
    return { records: finalized.slice(0, limit), warnings };
  }

  /**
   * @template Input, Output
   * @param {readonly Input[]} items
   * @param {number} concurrency
   * @param {(item: Input, index: number) => Promise<Output>} mapper
   * @returns {Promise<Output[]>}
   */
  static async mapWithConcurrency(items, concurrency, mapper) {
    return new OrderedConcurrentMapper(concurrency).map(items, mapper);
  }

  /** @param {JsonRecord} report @returns {SccacheReport} */
  static normalizeSccacheReport(report) {
    const {
      stage = "",
      baked_runtime_mode: bakedRuntimeMode = "",
      runtime_mode: runtimeMode = "",
      runtime_mode_source: runtimeModeSource = "",
    } = report;
    const normalizedStage = String(stage);
    const normalizedBakedRuntimeMode = String(bakedRuntimeMode);
    const normalizedRuntimeMode = String(runtimeMode);
    const normalizedRuntimeModeSource = String(runtimeModeSource);
    if (!normalizedStage)
      throw new Error("sccache report is missing its stage");
    if (normalizedBakedRuntimeMode !== "READ_WRITE") {
      throw new Error(
        `sccache report has invalid baked_runtime_mode: ${normalizedBakedRuntimeMode}`,
      );
    }
    if (normalizedRuntimeMode !== "READ_WRITE") {
      throw new Error(
        `sccache report has invalid runtime_mode: ${normalizedRuntimeMode}`,
      );
    }
    if (
      normalizedRuntimeModeSource !== "environment" &&
      normalizedRuntimeModeSource !== "runtime_secret"
    ) {
      throw new Error(
        `sccache report has invalid runtime_mode_source: ${normalizedRuntimeModeSource}`,
      );
    }
    if (typeof report.client_side !== "boolean") {
      throw new Error("sccache report has invalid client_side");
    }
    if (
      report.counter_reliability !== "authoritative" &&
      report.counter_reliability !== "backend_incomplete"
    ) {
      throw new Error("sccache report has invalid counter_reliability");
    }
    if (
      report.publication_status !== "pending_verification" &&
      report.publication_status !== "counters_observed"
    ) {
      throw new Error("sccache report has invalid publication_status");
    }
    /** @type {SccacheReport} */
    const normalized = {
      stage: normalizedStage,
      baked_runtime_mode: normalizedBakedRuntimeMode,
      runtime_mode: normalizedRuntimeMode,
      runtime_mode_source: normalizedRuntimeModeSource,
      client_side: report.client_side,
      counter_reliability: report.counter_reliability,
      publication_status: report.publication_status,
      compile_requests: CacheTelemetry.nonNegativeInteger(
        report.compile_requests,
      ),
      requests_executed: CacheTelemetry.nonNegativeInteger(
        report.requests_executed,
      ),
      cache_hits: CacheTelemetry.nonNegativeInteger(report.cache_hits),
      cache_misses: CacheTelemetry.nonNegativeInteger(report.cache_misses),
      cache_errors: CacheTelemetry.nonNegativeInteger(report.cache_errors),
      cache_write_errors: CacheTelemetry.nonNegativeInteger(
        report.cache_write_errors,
      ),
      cache_writes: CacheTelemetry.nonNegativeInteger(report.cache_writes),
      compile_failures: CacheTelemetry.nonNegativeInteger(
        report.compile_failures,
      ),
    };
    return normalized;
  }

  /** @param {readonly SccacheReport[]} reports @returns {SccacheSummary} */
  static summarizeSccache(reports) {
    /** @type {SccacheSummary} */
    const summary = {
      report_count: reports.length,
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
      compile_failures: 0,
      measurement: "sum_of_per_stage_terminal_snapshots",
      fallback: { state: "active", reason: "none" },
      snapshots: [],
    };
    const first = reports[0];
    if (first) {
      summary.baked_runtime_mode = first.baked_runtime_mode;
      summary.runtime_mode = first.runtime_mode;
      summary.runtime_mode_source = first.runtime_mode_source;
      summary.client_side = first.client_side;
      summary.counter_reliability = first.counter_reliability;
    }
    for (const report of reports) {
      for (const field of /** @type {const} */ ([
        "baked_runtime_mode",
        "runtime_mode",
        "runtime_mode_source",
        "client_side",
        "counter_reliability",
      ])) {
        if (report[field] !== summary[field]) {
          throw new Error(
            `inconsistent sccache ${field}: ${summary[field]} != ${report[field]}`,
          );
        }
      }
      summary.compile_requests += report.compile_requests;
      summary.requests_executed += report.requests_executed;
      summary.cache_hits += report.cache_hits;
      summary.cache_misses += report.cache_misses;
      summary.cache_errors += report.cache_errors;
      summary.cache_write_errors += report.cache_write_errors;
      summary.cache_writes += report.cache_writes;
      summary.compile_failures += report.compile_failures;
    }
    if (reports.length > 0) {
      summary.publication_status = summary.client_side && summary.cache_errors === 0 && summary.cache_write_errors === 0 && summary.cache_writes === 0
        ? "pending_verification"
        : "counters_observed";
    }
    summary.snapshots = reports;
    return {
      ...summary,
      ...CacheTelemetry.percentageField(
        "hit_rate_percent",
        summary.cache_hits,
        summary.cache_hits + summary.cache_misses,
      ),
    };
  }

  /**
   * @param {readonly BuildHistoryRecord[]} records
   * @param {readonly JsonRecord[]} [events]
   * @returns {BuildkitSummary}
   */
  static summarizeBuildkit(records, events = []) {
    const completedSteps = records.reduce(
      (total, record) => total + record.completed_steps,
      0,
    );
    const cachedSteps = records.reduce(
      (total, record) => total + record.cached_steps,
      0,
    );
    return {
      build_record_count: records.length,
      completed_steps: completedSteps,
      cached_steps: cachedSteps,
      ...CacheTelemetry.percentageField(
        "cache_hit_rate_percent",
        cachedSteps,
        completedSteps,
      ),
      cache_export: new BuildkitCacheExportTelemetry(events).summary(),
      measurement: "buildx_target_record_steps",
    };
  }

  /**
   * @param {readonly JsonRecord[]} events
   * @param {Set<string>} [seen]
   * @returns {SccacheReport[]}
   */
  static extractSccacheReports(events, seen = new Set()) {
    /** @type {SccacheReport[]} */
    const reports = [];
    /** @type {Map<string, string>} */
    const buffers = new Map();

    /** @param {string} line @param {JsonRecord} log */
    function inspectLine(line, log) {
      const markerAt = line.indexOf(SCCACHE_MARKER);
      if (markerAt === -1) return;
      const payload = line.slice(markerAt + SCCACHE_MARKER.length).trim();
      const vertex = typeof log.vertex === "string" ? log.vertex : "";
      const timestamp = typeof log.timestamp === "string" ? log.timestamp : "";
      const identity = `${vertex}:${timestamp}:${payload}`;
      if (seen.has(identity)) return;
      seen.add(identity);
      reports.push(
        CacheTelemetry.normalizeSccacheReport(
          CacheTelemetry.parseJsonRecord(payload),
        ),
      );
    }

    for (const event of events) {
      /** @type {unknown[]} */
      const logCandidates = Array.isArray(event.logs) ? event.logs : [];
      const logs = logCandidates.filter((candidate) =>
        CacheTelemetry.isJsonRecord(candidate),
      );
      for (const log of logs) {
        const vertex = typeof log.vertex === "string" ? log.vertex : "";
        const data = typeof log.data === "string" ? log.data : "";
        const key = `${vertex}`;
        const decoded = Buffer.from(data, "base64").toString("utf8");
        const [buffer = ""] = [buffers.get(key)];
        const lines = `${buffer}${decoded}`.split(/\r?\n/);
        const [remainder = ""] = [lines.pop()];
        buffers.set(key, remainder);
        for (const line of lines) inspectLine(line, log);
      }
    }
    for (const [key, line] of buffers) {
      inspectLine(line, { vertex: key, timestamp: "unterminated" });
    }
    return reports;
  }

  /** @param {readonly JsonRecord[]} events @returns {{state: 'active' | 'fallback', reason: string}} */
  static extractSccacheFallback(events) {
    let reason = "none";
    for (const event of events) {
      const candidates = Array.isArray(event.logs) ? event.logs : [];
      for (const candidate of candidates) {
        if (
          !CacheTelemetry.isJsonRecord(candidate) ||
          typeof candidate.data !== "string"
        )
          continue;
        const decoded = Buffer.from(candidate.data, "base64").toString("utf8");
        for (const line of decoded.split(/\r?\n/)) {
          const markerAt = line.indexOf(SCCACHE_FALLBACK_MARKER);
          if (markerAt === -1) continue;
          try {
            const fallback = CacheTelemetry.parseJsonRecord(
              line.slice(markerAt + SCCACHE_FALLBACK_MARKER.length).trim(),
            );
            if (typeof fallback.reason === "string" && fallback.reason) {
              reason = fallback.reason;
            }
          } catch {
            reason = "malformed_fallback_event";
          }
        }
      }
    }
    return reason === "none"
      ? { state: "active", reason }
      : { state: "fallback", reason };
  }

  /** @returns {BuildHistoryRecord[]} */
  static listBuildHistory() {
    const result = spawnSync(
      "docker",
      ["buildx", "history", "ls", "--format", "json", "--no-trunc"],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(
        result.stderr.trim() || `buildx history exited ${result.status}`,
      );
    }
    return CacheTelemetry.parseJsonObjects(result.stdout).map((record) =>
      CacheTelemetry.normalizeBuildRecord(record),
    );
  }

  /**
   * @param {string} ref
   * @param {number} [timeoutMs]
   * @returns {Promise<JsonRecord[]>}
   */
  static readHistoryEvents(ref, timeoutMs = HISTORY_LOG_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const child = spawn("docker", [
        "buildx",
        "history",
        "logs",
        CacheTelemetry.historyLogRef(ref),
        "--progress",
        "rawjson",
      ]);
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, timeoutMs);
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on("close", (status) => {
        clearTimeout(timeout);
        if (timedOut) {
          reject(
            new Error(`buildx history logs timed out after ${timeoutMs}ms`),
          );
          return;
        }
        const parsedStdout = CacheTelemetry.parseRawJsonProgress(stdout);
        const parsedStderr = CacheTelemetry.parseRawJsonProgress(stderr);
        const events = [...parsedStdout.objects, ...parsedStderr.objects];
        const diagnostics = [
          ...parsedStdout.diagnostics,
          ...parsedStderr.diagnostics,
        ];
        if (status === 0 && (events.length > 0 || diagnostics.length === 0)) {
          resolve(events);
        } else {
          reject(
            new Error(
              diagnostics.join("\n") ||
                stderr.trim() ||
                `buildx history logs exited ${status}`,
            ),
          );
        }
      });
    });
  }

  /** @param {NodeJS.ProcessEnv} [environment] @returns {CacheBackend} */
  static cacheBackendFromEnvironment(environment = process.env) {
    const kind =
      environment.NOOK_SCCACHE_BACKEND === "remote"
        ? "remote"
        : "direct_compile";
    const configuredReason =
      environment.NOOK_SCCACHE_BACKEND_REASON ||
      (kind === "remote" ? "persistent_service" : "credentials_unavailable");
    return {
      kind,
      persistent: kind === "remote",
      reason: configuredReason,
    };
  }

  /**
   * @param {unknown} record
   * @param {TelemetryIdentityExpectation} [expected]
   * @returns {JsonRecord}
   */
  static validateTelemetryRecord(record, expected = {}) {
    if (!CacheTelemetry.isJsonRecord(record))
      throw new Error("telemetry record is required");
    if (record.schema_version !== 1)
      throw new Error("telemetry schema_version must be 1");
    const github = record.github;
    if (!CacheTelemetry.isJsonRecord(github)) {
      throw new Error("telemetry github context is required");
    }
    if (typeof github.run_id !== "string") {
      throw new Error("telemetry github.run_id must be a string");
    }
    if (
      !Number.isInteger(github.run_attempt) ||
      typeof github.run_attempt !== "number" ||
      github.run_attempt < 1
    ) {
      throw new Error(
        "telemetry github.run_attempt must be a positive integer",
      );
    }
    if (typeof github.job !== "string" || !github.job) {
      throw new Error("telemetry github.job must be a non-empty string");
    }
    if ("runId" in expected && github.run_id !== String(expected.runId)) {
      throw new Error(
        `telemetry run ${github.run_id} does not match expected run ${expected.runId}`,
      );
    }
    if (
      "runAttempt" in expected &&
      github.run_attempt !== Number(expected.runAttempt)
    ) {
      throw new Error(
        `telemetry attempt ${github.run_attempt} does not match expected attempt ${expected.runAttempt}`,
      );
    }
    const cacheBackend = record.cache_backend;
    if (
      !CacheTelemetry.isJsonRecord(cacheBackend) ||
      (cacheBackend.kind !== "remote" && cacheBackend.kind !== "direct_compile")
    ) {
      throw new Error("telemetry cache_backend.kind is invalid");
    }
    if (typeof cacheBackend.persistent !== "boolean") {
      throw new Error("telemetry cache_backend.persistent must be boolean");
    }
    if (cacheBackend.persistent !== (cacheBackend.kind === "remote")) {
      throw new Error("telemetry cache backend persistence is inconsistent");
    }
    if (typeof cacheBackend.reason !== "string" || !cacheBackend.reason) {
      throw new Error("telemetry cache_backend.reason is required");
    }
    const sccache = record.sccache;
    if (!CacheTelemetry.isJsonRecord(sccache)) {
      throw new Error("telemetry sccache summary is required");
    }
    const availableAuthority =
      typeof sccache.report_count === "number" && sccache.report_count > 0;
    const allowedRuntimeModes = availableAuthority ? ["READ_WRITE"] : ["UNAVAILABLE"];
    for (const field of ["baked_runtime_mode", "runtime_mode"]) {
      const value = sccache[field];
      if (
        typeof value !== "string" ||
        !allowedRuntimeModes.includes(value)
      ) {
        throw new Error(`telemetry sccache.${field} is invalid`);
      }
    }
    const allowedRuntimeModeSources = availableAuthority
      ? ["environment", "runtime_secret"]
      : ["unavailable"];
    if (
      typeof sccache.runtime_mode_source !== "string" ||
      !allowedRuntimeModeSources.includes(sccache.runtime_mode_source)
    ) {
      throw new Error("telemetry sccache.runtime_mode_source is invalid");
    }
    if (typeof sccache.client_side !== "boolean") {
      throw new Error("telemetry sccache.client_side is invalid");
    }
    const allowedCounterReliability = availableAuthority
      ? ["authoritative", "backend_incomplete"]
      : ["unavailable"];
    if (
      typeof sccache.counter_reliability !== "string" ||
      !allowedCounterReliability.includes(sccache.counter_reliability)
    ) {
      throw new Error("telemetry sccache.counter_reliability is invalid");
    }
    const allowedPublicationStatus = availableAuthority
      ? ["pending_verification", "counters_observed"]
      : ["unavailable"];
    if (
      typeof sccache.publication_status !== "string" ||
      !allowedPublicationStatus.includes(sccache.publication_status)
    ) {
      throw new Error("telemetry sccache.publication_status is invalid");
    }
    for (const [field, value] of Object.entries({
      report_count: sccache.report_count,
      compile_requests: sccache.compile_requests,
      requests_executed: sccache.requests_executed,
      cache_hits: sccache.cache_hits,
      cache_misses: sccache.cache_misses,
      cache_errors: sccache.cache_errors,
      cache_write_errors: sccache.cache_write_errors,
      cache_writes: sccache.cache_writes,
      compile_failures: sccache.compile_failures,
    })) {
      if (!Number.isInteger(value) || typeof value !== "number" || value < 0) {
        throw new Error(
          `telemetry sccache.${field} must be a non-negative integer`,
        );
      }
    }
    CacheTelemetry.validateOptionalRate(sccache, "hit_rate_percent", "sccache");
    if (sccache.measurement !== "sum_of_per_stage_terminal_snapshots") {
      throw new Error("telemetry sccache.measurement is invalid");
    }
    if (
      !CacheTelemetry.isJsonRecord(sccache.fallback) ||
      !["active", "fallback"].includes(sccache.fallback.state) ||
      typeof sccache.fallback.reason !== "string"
    ) {
      throw new Error("telemetry sccache.fallback is invalid");
    }
    if (!Array.isArray(sccache.snapshots)) {
      throw new Error("telemetry sccache.snapshots must be an array");
    }
    const buildkit = record.buildkit;
    if (!CacheTelemetry.isJsonRecord(buildkit)) {
      throw new Error("telemetry buildkit summary is required");
    }
    for (const [field, value] of Object.entries({
      build_record_count: buildkit.build_record_count,
      completed_steps: buildkit.completed_steps,
      cached_steps: buildkit.cached_steps,
    })) {
      if (!Number.isInteger(value) || typeof value !== "number" || value < 0) {
        throw new Error(
          `telemetry buildkit.${field} must be a non-negative integer`,
        );
      }
    }
    CacheTelemetry.validateOptionalRate(
      buildkit,
      "cache_hit_rate_percent",
      "buildkit",
    );
    const cacheExport = buildkit.cache_export;
    if ("cache_export" in buildkit) {
      if (!CacheTelemetry.isJsonRecord(cacheExport)) {
        throw new Error("telemetry buildkit.cache_export must be an object");
      }
      for (const [field, value] of Object.entries({
        attempts: cacheExport.attempts,
        completed: cacheExport.completed,
        bytes: cacheExport.bytes,
        duration_ms: cacheExport.duration_ms,
        incomplete_failures: cacheExport.incomplete_failures,
      })) {
        if (
          !Number.isInteger(value) ||
          typeof value !== "number" ||
          value < 0
        ) {
          throw new Error(
            `telemetry buildkit.cache_export.${field} must be a non-negative integer`,
          );
        }
      }
    }
    const collection = record.collection;
    if (
      !CacheTelemetry.isJsonRecord(collection) ||
      typeof collection.complete !== "boolean"
    ) {
      throw new Error("telemetry collection status is required");
    }
    if (
      !Array.isArray(collection.warnings) ||
      !collection.warnings.every((warning) => typeof warning === "string")
    ) {
      throw new Error("telemetry collection.warnings must be an array");
    }
    if (
      "failures" in collection &&
      (!Array.isArray(collection.failures) ||
        !collection.failures.every(
          (failure) =>
            CacheTelemetry.isJsonRecord(failure) &&
            typeof failure.component === "string" &&
            typeof failure.reference === "string" &&
            typeof failure.message === "string",
        ))
    ) {
      throw new Error("telemetry collection.failures must be an array");
    }
    return record;
  }

  /**
   * @param {JsonRecord} summary
   * @param {string} field
   * @param {string} label
   * @returns {void}
   */
  static validateOptionalRate(summary, field, label) {
    if (!(field in summary)) return;
    const rate = summary[field];
    if (typeof rate !== "number" || !Number.isFinite(rate)) {
      throw new Error(
        `telemetry ${label} cache rate must be numeric when present`,
      );
    }
    if (rate < 0 || rate > 100) {
      throw new Error(
        `telemetry ${label} cache rate must be 0..100 when measured`,
      );
    }
  }

  /** @param {CollectTelemetryRequest} request @returns {Promise<CacheTelemetryRecord>} */
  static async collectTelemetry({
    baselineRefs,
    baselineWarnings = [],
    job = "",
    runId = "",
    runAttempt,
    environment = process.env,
  }) {
    const warnings = [...baselineWarnings];
    /** @type {CollectionFailure[]} */
    const failures = baselineWarnings.map((warning) => ({
      component: "buildx_history",
      reference: "baseline",
      message: warning,
    }));
    /** @type {BuildHistoryRecord[]} */
    let records = [];
    try {
      const baseline = new Set(baselineRefs);
      const candidates = CacheTelemetry.listBuildHistory().filter(
        (record) => record.ref && !baseline.has(record.ref),
      );
      const selection = CacheTelemetry.selectBuildRecords(candidates);
      records = selection.records;
      warnings.push(...selection.warnings);
    } catch (error) {
      const message = CacheTelemetry.errorMessage(error);
      warnings.push(`buildx_history_unavailable: ${message}`);
      failures.push({
        component: "buildx_history",
        reference: "current",
        message,
      });
    }

    /** @type {SccacheReport[]} */
    const reports = [];
    /** @type {JsonRecord[]} */
    const historyEvents = [];
    const seenReports = new Set();
    const logResults = await CacheTelemetry.mapWithConcurrency(
      records,
      HISTORY_LOG_CONCURRENCY,
      async (record) => {
        try {
          return {
            kind: HistoryLogCollectionKind.Collected,
            record,
            events: await CacheTelemetry.readHistoryEvents(record.ref),
          };
        } catch (error) {
          return {
            kind: HistoryLogCollectionKind.Unavailable,
            record,
            message: CacheTelemetry.errorMessage(error),
          };
        }
      },
    );
    for (const result of logResults) {
      switch (result.kind) {
        case HistoryLogCollectionKind.Unavailable:
          warnings.push(
            `buildx_logs_unavailable:${result.record.ref}: ${result.message}`,
          );
          failures.push({
            component: "buildx_logs",
            reference: result.record.ref,
            message: result.message,
          });
          break;
        case HistoryLogCollectionKind.Collected:
          historyEvents.push(
            ...result.events.map((event) => ({
              ...event,
              nook_history_ref: result.record.ref,
            })),
          );
          reports.push(
            ...CacheTelemetry.extractSccacheReports(result.events, seenReports),
          );
          break;
      }
    }

    const buildkit = CacheTelemetry.summarizeBuildkit(records, historyEvents);
    if (buildkit.cache_export.incomplete_failures > 0) {
      warnings.push(
        `buildkit_cache_export_incomplete:${buildkit.cache_export.incomplete_failures}`,
      );
      failures.push({
        component: "buildkit_cache_export",
        reference: "registry",
        message: `${buildkit.cache_export.incomplete_failures} cache export attempts did not complete`,
      });
    }
    const sccache = CacheTelemetry.summarizeSccache(reports);
    sccache.fallback = CacheTelemetry.extractSccacheFallback(historyEvents);

    return {
      schema_version: 1,
      github: {
        run_id: String(runId),
        run_attempt: CacheTelemetry.nonNegativeInteger(runAttempt, 1),
        job: String(job),
      },
      cache_backend: CacheTelemetry.cacheBackendFromEnvironment(environment),
      cache_scope: new CacheScopeTelemetry(environment).record(),
      sccache,
      buildkit,
      buildkit_records: records,
      collection: {
        complete: warnings.length === 0,
        warnings,
        failures,
      },
    };
  }

  /**
   * @param {UnavailableTelemetryRequest} request
   * @returns {CacheTelemetryRecord}
   */
  static buildUnavailableTelemetry({
    warning,
    job = "",
    runId = "",
    runAttempt,
    environment = process.env,
  }) {
    return {
      schema_version: 1,
      github: {
        run_id: String(runId),
        run_attempt: CacheTelemetry.nonNegativeInteger(runAttempt, 1),
        job: String(job),
      },
      cache_backend: CacheTelemetry.cacheBackendFromEnvironment(environment),
      cache_scope: new CacheScopeTelemetry(environment).record(),
      sccache: CacheTelemetry.summarizeSccache([]),
      buildkit: CacheTelemetry.summarizeBuildkit([]),
      buildkit_records: [],
      collection: {
        complete: false,
        warnings: [String(warning)],
        failures: [
          {
            component: "collector",
            reference: "cache-telemetry",
            message: String(warning),
          },
        ],
      },
    };
  }

  /** @param {string} filename @param {object} value @returns {void} */
  static writeJson(filename, value) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    /** @type {(key: string, value: unknown) => unknown} */
    const replacer = (key, nestedValue) =>
      CacheTelemetry.retainJsonValue(key, nestedValue);
    fs.writeFileSync(filename, `${JSON.stringify(value, replacer, 2)}\n`);
  }

  /**
   * @param {CacheTelemetryRecord} record
   * @param {string} [filename]
   * @returns {void}
   */
  static appendJobSummary(record, filename = process.env.GITHUB_STEP_SUMMARY) {
    if (!filename) return;
    const compilerRate = !Number.isFinite(record.sccache.hit_rate_percent)
      ? "n/a (no executed cacheable compiler requests)"
      : `${record.sccache.hit_rate_percent}%`;
    const buildkitRate = !Number.isFinite(
      record.buildkit.cache_hit_rate_percent,
    )
      ? "n/a (no completed Buildx steps)"
      : `${record.buildkit.cache_hit_rate_percent}%`;
    fs.appendFileSync(
      filename,
      [
        "### Cache telemetry",
        "",
        `- sccache backend: \`${record.cache_backend.kind}\` (${record.cache_backend.reason})`,
        `- sccache authority: baked=\`${record.sccache.baked_runtime_mode}\`, effective=\`${record.sccache.runtime_mode}\`, source=\`${record.sccache.runtime_mode_source}\``,
        `- sccache counters: \`${record.sccache.counter_reliability}\` (client-side=\`${record.sccache.client_side}\`)`,
        `- sccache publication: \`${record.sccache.publication_status}\``,
        `- sccache measurement: \`${record.sccache.measurement}\`; fallback=\`${record.sccache.fallback.state}\` (${record.sccache.fallback.reason})`,
        `- sccache requests: ${record.sccache.compile_requests} received, ${record.sccache.requests_executed} executed, ${record.sccache.compile_failures} compile failures`,
        `- sccache cache results: ${record.sccache.cache_hits} hits, ${record.sccache.cache_misses} misses, ${record.sccache.cache_writes} writes`,
        `- sccache errors: ${record.sccache.cache_errors} cache operations, ${record.sccache.cache_write_errors} cache writes`,
        `- sccache hit rate: ${compilerRate} (${record.sccache.cache_hits} hits / ${record.sccache.cache_hits + record.sccache.cache_misses} lookups)`,
        `- BuildKit target-step cache rate: ${buildkitRate} (${record.buildkit.cached_steps} cached / ${record.buildkit.completed_steps} completed)`,
        `- BuildKit registry cache export: ${record.buildkit.cache_export.bytes} bytes across ${record.buildkit.cache_export.completed}/${record.buildkit.cache_export.attempts} completed attempts in ${record.buildkit.cache_export.duration_ms} ms (${record.buildkit.cache_export.incomplete_failures} incomplete failures)`,
        "",
      ].join("\n"),
    );
  }

  /** @param {readonly string[]} arguments_ @param {string} name @returns {string} */
  static argumentValue(arguments_, name) {
    const index = arguments_.indexOf(name);
    const value = arguments_.at(index + 1);
    if (index === -1 || !value) throw new Error(`${name} is required`);
    return value;
  }

  /** @param {readonly string[]} [arguments_] @returns {Promise<void>} */
  static async main(arguments_ = process.argv.slice(2)) {
    const command = arguments_[0];
    const output = CacheTelemetry.argumentValue(arguments_, "--output");
    if (command === "start") {
      const warnings = [];
      /** @type {string[]} */
      let refs = [];
      try {
        refs = CacheTelemetry.listBuildHistory()
          .map((record) => record.ref)
          .filter(Boolean);
      } catch (error) {
        warnings.push(
          `buildx_history_unavailable: ${CacheTelemetry.errorMessage(error)}`,
        );
      }
      CacheTelemetry.writeJson(output, { schema_version: 1, refs, warnings });
      return;
    }
    if (command === "unavailable") {
      const record = CacheTelemetry.buildUnavailableTelemetry({
        warning: CacheTelemetry.argumentValue(arguments_, "--warning"),
        ...(process.env.GITHUB_JOB ? { job: process.env.GITHUB_JOB } : {}),
        ...(process.env.GITHUB_RUN_ID
          ? { runId: process.env.GITHUB_RUN_ID }
          : {}),
        ...(process.env.GITHUB_RUN_ATTEMPT
          ? { runAttempt: process.env.GITHUB_RUN_ATTEMPT }
          : {}),
      });
      CacheTelemetry.validateTelemetryRecord(record);
      CacheTelemetry.writeJson(output, record);
      CacheTelemetry.appendJobSummary(record);
      return;
    }
    if (command !== "collect") throw new Error("expected start or collect");

    const baseline = CacheTelemetry.parseBuildHistoryBaseline(
      fs.readFileSync(
        CacheTelemetry.argumentValue(arguments_, "--baseline"),
        "utf8",
      ),
    );
    const { refs: baselineRefs, warnings: baselineWarnings } = baseline;
    const record = await CacheTelemetry.collectTelemetry({
      baselineRefs,
      baselineWarnings,
      ...(process.env.GITHUB_JOB ? { job: process.env.GITHUB_JOB } : {}),
      ...(process.env.GITHUB_RUN_ID
        ? { runId: process.env.GITHUB_RUN_ID }
        : {}),
      ...(process.env.GITHUB_RUN_ATTEMPT
        ? { runAttempt: process.env.GITHUB_RUN_ATTEMPT }
        : {}),
    });
    CacheTelemetry.validateTelemetryRecord(record);
    CacheTelemetry.writeJson(output, record);
    CacheTelemetry.appendJobSummary(record);
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void CacheTelemetry.main().catch((error) => {
    const failure = error instanceof Error ? error : new Error(String(error));
    process.stderr.write(
      `cache telemetry: ${failure.stack || failure.message}\n`,
    );
    process.exitCode = 1;
  });
}
