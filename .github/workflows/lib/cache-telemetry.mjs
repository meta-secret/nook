import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCCACHE_MARKER = "NOOK_SCCACHE_STATS ";
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
 * @property {number} compile_requests
 * @property {number} requests_executed
 * @property {number} cache_hits
 * @property {number} cache_misses
 * @property {number} cache_errors
 * @property {number} cache_writes
 */
/**
 * @typedef {object} SccacheSummary
 * @property {number} report_count
 * @property {number} compile_requests
 * @property {number} requests_executed
 * @property {number} cache_hits
 * @property {number} cache_misses
 * @property {number} cache_errors
 * @property {number} cache_writes
 * @property {number} [hit_rate_percent]
 */
/**
 * @typedef {object} BuildkitSummary
 * @property {number} build_record_count
 * @property {number} completed_steps
 * @property {number} cached_steps
 * @property {number} [cache_hit_rate_percent]
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
 * @property {SccacheSummary} sccache
 * @property {BuildkitSummary} buildkit
 * @property {readonly BuildHistoryRecord[]} buildkit_records
 * @property {{complete: boolean, warnings: readonly string[]}} collection
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
    /** @type {Output[]} */
    const results = new Array(items.length);
    const entries = items.entries();
    async function worker() {
      for (const [index, item] of entries) {
        results[index] = await mapper(item, index);
      }
    }
    const workerCount = Math.min(concurrency, items.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
  }

  /** @param {JsonRecord} report @returns {SccacheReport} */
  static normalizeSccacheReport(report) {
    const { stage = "" } = report;
    const normalized = {
      stage: String(stage),
      compile_requests: CacheTelemetry.nonNegativeInteger(
        report.compile_requests,
      ),
      requests_executed: CacheTelemetry.nonNegativeInteger(
        report.requests_executed,
      ),
      cache_hits: CacheTelemetry.nonNegativeInteger(report.cache_hits),
      cache_misses: CacheTelemetry.nonNegativeInteger(report.cache_misses),
      cache_errors: CacheTelemetry.nonNegativeInteger(report.cache_errors),
      cache_writes: CacheTelemetry.nonNegativeInteger(report.cache_writes),
    };
    if (!normalized.stage)
      throw new Error("sccache report is missing its stage");
    return normalized;
  }

  /** @param {readonly SccacheReport[]} reports @returns {SccacheSummary} */
  static summarizeSccache(reports) {
    const summary = {
      report_count: reports.length,
      compile_requests: 0,
      requests_executed: 0,
      cache_hits: 0,
      cache_misses: 0,
      cache_errors: 0,
      cache_writes: 0,
    };
    for (const report of reports) {
      summary.compile_requests += report.compile_requests;
      summary.requests_executed += report.requests_executed;
      summary.cache_hits += report.cache_hits;
      summary.cache_misses += report.cache_misses;
      summary.cache_errors += report.cache_errors;
      summary.cache_writes += report.cache_writes;
    }
    return {
      ...summary,
      ...CacheTelemetry.percentageField(
        "hit_rate_percent",
        summary.cache_hits,
        summary.cache_hits + summary.cache_misses,
      ),
    };
  }

  /** @param {readonly BuildHistoryRecord[]} records @returns {BuildkitSummary} */
  static summarizeBuildkit(records) {
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
    return {
      kind,
      persistent: kind === "remote",
      reason:
        environment.NOOK_SCCACHE_BACKEND_REASON ||
        (kind === "remote" ? "persistent_service" : "credentials_unavailable"),
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
    for (const [field, value] of Object.entries({
      report_count: sccache.report_count,
      compile_requests: sccache.compile_requests,
      requests_executed: sccache.requests_executed,
      cache_hits: sccache.cache_hits,
      cache_misses: sccache.cache_misses,
      cache_errors: sccache.cache_errors,
      cache_writes: sccache.cache_writes,
    })) {
      if (!Number.isInteger(value) || typeof value !== "number" || value < 0) {
        throw new Error(
          `telemetry sccache.${field} must be a non-negative integer`,
        );
      }
    }
    CacheTelemetry.validateOptionalRate(sccache, "hit_rate_percent", "sccache");
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
      warnings.push(
        `buildx_history_unavailable: ${CacheTelemetry.errorMessage(error)}`,
      );
    }

    /** @type {SccacheReport[]} */
    const reports = [];
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
          break;
        case HistoryLogCollectionKind.Collected:
          reports.push(
            ...CacheTelemetry.extractSccacheReports(result.events, seenReports),
          );
          break;
      }
    }

    return {
      schema_version: 1,
      github: {
        run_id: String(runId),
        run_attempt: CacheTelemetry.nonNegativeInteger(runAttempt, 1),
        job: String(job),
      },
      cache_backend: CacheTelemetry.cacheBackendFromEnvironment(environment),
      sccache: CacheTelemetry.summarizeSccache(reports),
      buildkit: CacheTelemetry.summarizeBuildkit(records),
      buildkit_records: records,
      collection: {
        complete: warnings.length === 0,
        warnings,
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
      sccache: CacheTelemetry.summarizeSccache([]),
      buildkit: CacheTelemetry.summarizeBuildkit([]),
      buildkit_records: [],
      collection: {
        complete: false,
        warnings: [String(warning)],
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
        `- sccache hit rate: ${compilerRate} (${record.sccache.cache_hits} hits / ${record.sccache.cache_hits + record.sccache.cache_misses} lookups)`,
        `- BuildKit target-step cache rate: ${buildkitRate} (${record.buildkit.cached_steps} cached / ${record.buildkit.completed_steps} completed)`,
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
