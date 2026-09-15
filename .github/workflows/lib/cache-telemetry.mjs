import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { BuildkitCacheExportTelemetry } from "./buildkit-cache-export-telemetry.mjs";
import { CacheScopeTelemetry } from "./cache-scope-telemetry.mjs";
import { CacheTelemetryValidator } from "./cache-telemetry-validator.mjs";
import { OrderedConcurrentMapper } from "./ordered-concurrent-mapper.mjs";

export { BuildkitCacheExportTelemetry };

export { CacheScopeTelemetry };

const SCCACHE_MARKER = "NOOK_SCCACHE_STATS ";
const SCCACHE_FALLBACK_MARKER = "NOOK_SCCACHE_FALLBACK ";
const HISTORY_LOG_CONCURRENCY = 8;
const HISTORY_LOG_TIMEOUT_MS = 12_000;
const HISTORY_RECORD_LIMIT = 32;
const HistoryLogCollectionKind = Object.freeze({
  Collected: "collected",
  Unavailable: "unavailable",
});

/** @typedef {import("./cache-telemetry-contracts.mjs").JsonRecord} JsonRecord */
/** @typedef {import("./cache-telemetry-contracts.mjs").BuildHistoryRecord} BuildHistoryRecord */
/** @typedef {import("./cache-telemetry-contracts.mjs").SccacheReport} SccacheReport */
/** @typedef {import("./cache-telemetry-contracts.mjs").SccacheSummary} SccacheSummary */
/** @typedef {import("./cache-telemetry-contracts.mjs").BuildkitSummary} BuildkitSummary */
/** @typedef {import("./cache-telemetry-contracts.mjs").CacheBackend} CacheBackend */
/** @typedef {import("./cache-telemetry-contracts.mjs").CacheTelemetryRecord} CacheTelemetryRecord */
/** @typedef {import("./cache-telemetry-contracts.mjs").CollectionFailure} CollectionFailure */
/** @typedef {import("./cache-telemetry-contracts.mjs").RawJsonProgress} RawJsonProgress */
/** @typedef {import("./cache-telemetry-contracts.mjs").TelemetryIdentityExpectation} TelemetryIdentityExpectation */
/** @typedef {import("./cache-telemetry-contracts.mjs").CollectTelemetryRequest} CollectTelemetryRequest */
/** @typedef {import("./cache-telemetry-contracts.mjs").BuildHistoryBaseline} BuildHistoryBaseline */
/**
 * @typedef {{kind: typeof HistoryLogCollectionKind.Collected, record: BuildHistoryRecord, events: JsonRecord[]} | {kind: typeof HistoryLogCollectionKind.Unavailable, record: BuildHistoryRecord, message: string}} HistoryLogCollection
 */
/** @typedef {import("./cache-telemetry-contracts.mjs").UnavailableTelemetryRequest} UnavailableTelemetryRequest */

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
   * @param {{includeUnfinished?: boolean}} [options]
   * @returns {{records: BuildHistoryRecord[], warnings: string[]}}
   */
  static selectBuildRecords(
    records,
    limit = HISTORY_RECORD_LIMIT,
    { includeUnfinished = true } = {},
  ) {
    const candidates = includeUnfinished
      ? [...records]
      : records.filter((record) => record.completed_at);
    const selected = candidates.sort((left, right) => {
      const activity = CacheTelemetry.compareStrings(
        String(right.completed_at || right.started_at || ""),
        String(left.completed_at || left.started_at || ""),
      );
      if (activity !== 0) return activity;
      const started = CacheTelemetry.compareStrings(
        String(right.started_at || ""),
        String(left.started_at || ""),
      );
      if (started !== 0) return started;
      return CacheTelemetry.compareStrings(left.ref, right.ref);
    });
    const warnings = [];
    const unfinishedCount = records.filter(
      (record) => !record.completed_at,
    ).length;
    if (includeUnfinished && unfinishedCount > 0) {
      warnings.push(`buildx_records_unfinished_included:${unfinishedCount}`);
    }
    if (selected.length > limit) {
      warnings.push(`buildx_records_truncated:${limit}/${selected.length}`);
    }
    return { records: selected.slice(0, limit), warnings };
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
    const terminalReports = [
      ...new Map(reports.map((report) => [report.stage, report])).values(),
    ];
    /** @type {SccacheSummary} */
    const summary = {
      report_count: terminalReports.length,
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
      measurement: "sum_of_zero_based_run_snapshots",
      fallback: { state: "active", reason: "none" },
      snapshots: [],
    };
    const first = terminalReports[0];
    if (first) {
      summary.baked_runtime_mode = first.baked_runtime_mode;
      summary.runtime_mode = first.runtime_mode;
      summary.runtime_mode_source = first.runtime_mode_source;
      summary.client_side = first.client_side;
      summary.counter_reliability = first.counter_reliability;
    }
    for (const report of terminalReports) {
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
    if (terminalReports.length > 0) {
      summary.publication_status =
        summary.client_side &&
        summary.cache_errors === 0 &&
        summary.cache_write_errors === 0 &&
        summary.cache_writes === 0
          ? "pending_verification"
          : "counters_observed";
    }
    summary.snapshots = terminalReports;
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

  /** @param {string} text @returns {SccacheReport[]} */
  static extractSccacheReportsFromText(text) {
    /** @type {Map<string, SccacheReport>} */
    const latestByStage = new Map();
    for (const line of text.split(/\r?\n/)) {
      const markerAt = line.indexOf(SCCACHE_MARKER);
      if (markerAt === -1) continue;
      try {
        const report = CacheTelemetry.normalizeSccacheReport(
          CacheTelemetry.parseJsonRecord(
            line.slice(markerAt + SCCACHE_MARKER.length).trim(),
          ),
        );
        latestByStage.set(report.stage, report);
      } catch {
        // A cancelled write can leave one partial terminal line. Completed
        // stage records remain usable and the collection warning identifies
        // the cancelled overall solve.
      }
    }
    return [...latestByStage.values()];
  }

  /** @param {string} text @returns {{state: 'active' | 'fallback', reason: string}} */
  static extractSccacheFallbackFromText(text) {
    let reason = "none";
    for (const line of text.split(/\r?\n/)) {
      const reportAt = line.indexOf(SCCACHE_MARKER);
      if (reportAt !== -1) {
        try {
          const report = CacheTelemetry.normalizeSccacheReport(
            CacheTelemetry.parseJsonRecord(
              line.slice(reportAt + SCCACHE_MARKER.length).trim(),
            ),
          );
          // A completed healthy READ_WRITE snapshot is the terminal effective
          // state for that compiler stage. BuildKit's interleaved log retains
          // fallback markers from earlier vertices, so an any-event reduction
          // incorrectly labels a later healthy build as direct compilation.
          if (
            report.runtime_mode === "READ_WRITE" &&
            report.cache_errors === 0 &&
            report.cache_write_errors === 0 &&
            report.compile_failures === 0 &&
            (report.cache_hits > 0 || report.cache_misses > 0)
          ) {
            reason = "none";
          }
        } catch {
          // Partial reports are expected when cancellation interrupts a line.
        }
      }
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
    return reason === "none"
      ? { state: "active", reason }
      : { state: "fallback", reason };
  }

  /** @param {readonly JsonRecord[]} events @returns {{state: 'active' | 'fallback', reason: string}} */
  static extractSccacheFallback(events) {
    let text = "";
    for (const event of events) {
      const candidates = Array.isArray(event.logs) ? event.logs : [];
      for (const candidate of candidates) {
        if (
          !CacheTelemetry.isJsonRecord(candidate) ||
          typeof candidate.data !== "string"
        )
          continue;
        text += `${Buffer.from(candidate.data, "base64").toString("utf8")}\n`;
      }
    }
    return CacheTelemetry.extractSccacheFallbackFromText(text);
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
        if (events.length > 0 || (status === 0 && diagnostics.length === 0)) {
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
    return new CacheTelemetryValidator().validate(record, expected);
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
      const selection = CacheTelemetry.selectBuildRecords(
        candidates,
        HISTORY_RECORD_LIMIT,
        {
          includeUnfinished:
            environment.NOOK_CACHE_TELEMETRY_JOB_STATUS !== "success",
        },
      );
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
    let rawBuildLog = "";
    const rawBuildLogPath =
      environment.NOOK_BUILDKIT_RAW_LOG ||
      (environment.RUNNER_TEMP
        ? path.join(environment.RUNNER_TEMP, "nook-build-compile.raw.log")
        : "");
    if (rawBuildLogPath && fs.existsSync(rawBuildLogPath)) {
      try {
        rawBuildLog = fs.readFileSync(rawBuildLogPath, "utf8");
        reports.push(
          ...CacheTelemetry.extractSccacheReportsFromText(rawBuildLog),
        );
      } catch (error) {
        warnings.push(
          `buildx_raw_log_unavailable: ${CacheTelemetry.errorMessage(error)}`,
        );
      }
    }
    const reportsFromRawLog = reports.length > 0;
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
          if (!reportsFromRawLog) {
            reports.push(
              ...CacheTelemetry.extractSccacheReports(
                result.events,
                seenReports,
              ),
            );
          }
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
    sccache.fallback = rawBuildLog
      ? CacheTelemetry.extractSccacheFallbackFromText(rawBuildLog)
      : CacheTelemetry.extractSccacheFallback(historyEvents);

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
