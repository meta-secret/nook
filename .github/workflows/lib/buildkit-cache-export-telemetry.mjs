/** @typedef {Record<string, unknown>} JsonRecord */
export const BuildkitCacheExportByteMeasurementStatus = Object.freeze({
  Measured: "measured",
  Unavailable: "unavailable",
});
export const BuildkitCacheExportByteUnavailableReason = Object.freeze({
  NotEmitted: "buildkit_did_not_emit_byte_count",
});
/** @typedef {{status: 'measured', bytes: number}} MeasuredCacheExportBytes */
/** @typedef {{status: 'unavailable', reason: 'buildkit_did_not_emit_byte_count'}} UnavailableCacheExportBytes */
/** @typedef {MeasuredCacheExportBytes | UnavailableCacheExportBytes} CacheExportByteMeasurement */
/**
 * @typedef {object} CacheExportSummary
 * @property {number} attempts
 * @property {number} completed
 * @property {CacheExportByteMeasurement} byte_measurement
 * @property {number} duration_ms
 * @property {number} incomplete_failures
 */

export class BuildkitCacheExportTelemetry {
  /** @param {readonly JsonRecord[]} events */
  constructor(events) {
    this.events = events;
  }

  /** @param {unknown} value @returns {value is JsonRecord} */
  isJsonRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  /** @returns {CacheExportSummary} */
  summary() {
    /** @type {Map<string, {started?: string, completed?: string, failed: boolean}>} */
    const exportsByVertex = new Map();
    /** @type {Map<string, number>} */
    const bytesByStatus = new Map();
    for (const event of this.events) {
      const historyReference =
        typeof event.nook_history_ref === "string"
          ? event.nook_history_ref
          : "";
      const vertexes = Array.isArray(event.vertexes) ? event.vertexes : [];
      for (const candidate of vertexes) {
        if (!this.isJsonRecord(candidate)) continue;
        const digest =
          typeof candidate.digest === "string" ? candidate.digest : "";
        const name = typeof candidate.name === "string" ? candidate.name : "";
        if (!digest || !/exporting cache to registry/i.test(name)) continue;
        const vertexKey = `${historyReference}:${digest}`;
        const previous = exportsByVertex.get(vertexKey) || { failed: false };
        exportsByVertex.set(vertexKey, {
          ...(typeof candidate.started === "string"
            ? { started: candidate.started }
            : previous.started
              ? { started: previous.started }
              : {}),
          ...(typeof candidate.completed === "string"
            ? { completed: candidate.completed }
            : previous.completed
              ? { completed: previous.completed }
              : {}),
          failed:
            previous.failed ||
            (typeof candidate.error === "string" && candidate.error.length > 0),
        });
      }
    }
    for (const event of this.events) {
      const historyReference =
        typeof event.nook_history_ref === "string"
          ? event.nook_history_ref
          : "";
      const statuses = Array.isArray(event.statuses) ? event.statuses : [];
      const historyHasCacheExport = [...exportsByVertex.keys()].some((key) =>
        key.startsWith(`${historyReference}:`),
      );
      for (const candidate of statuses) {
        if (!this.isJsonRecord(candidate)) continue;
        const vertex =
          typeof candidate.vertex === "string" ? candidate.vertex : "";
        const vertexKey = `${historyReference}:${vertex}`;
        const id = typeof candidate.id === "string" ? candidate.id : "";
        const name = typeof candidate.name === "string" ? candidate.name : "";
        const belongsToCacheExport =
          exportsByVertex.has(vertexKey) ||
          (historyHasCacheExport &&
            /(push|upload|writ).*(cache|manifest|blob|layer)|(cache|manifest|blob|layer).*(push|upload|writ)/i.test(
              `${id} ${name}`,
            ));
        if (!belongsToCacheExport) continue;
        // Completed BuildKit status records may reset `current` to zero after
        // the transfer, so retain a positive `total`. Zero-only counters are
        // placeholders and do not prove that BuildKit emitted transfer bytes.
        const currentValue = candidate.current;
        const totalValue = candidate.total;
        const currentIsMeasured =
          typeof currentValue === "number" &&
          Number.isInteger(currentValue) &&
          currentValue >= 0;
        const totalIsMeasured =
          typeof totalValue === "number" &&
          Number.isInteger(totalValue) &&
          totalValue >= 0;
        if (!currentIsMeasured && !totalIsMeasured) continue;
        const observedCurrent = currentIsMeasured ? Number(currentValue) : 0;
        const observedTotal = totalIsMeasured ? Number(totalValue) : 0;
        const current =
          observedCurrent > 0
            ? observedCurrent
            : totalIsMeasured
              ? observedTotal
              : observedCurrent;
        if (current <= 0) continue;
        const key = `${vertexKey}:${id}`;
        bytesByStatus.set(key, Math.max(bytesByStatus.get(key) || 0, current));
      }
    }
    let completed = 0;
    let durationMs = 0;
    let incompleteFailures = 0;
    for (const cacheExport of exportsByVertex.values()) {
      if (cacheExport.completed && !cacheExport.failed) completed += 1;
      if (cacheExport.failed || !cacheExport.completed) incompleteFailures += 1;
      if (cacheExport.started && cacheExport.completed) {
        const started = Date.parse(cacheExport.started);
        const finished = Date.parse(cacheExport.completed);
        if (Number.isFinite(started) && Number.isFinite(finished)) {
          durationMs += Math.max(0, finished - started);
        }
      }
    }
    /** @type {CacheExportByteMeasurement} */
    const byteMeasurement =
      bytesByStatus.size > 0
        ? {
            status: BuildkitCacheExportByteMeasurementStatus.Measured,
            bytes: [...bytesByStatus.values()].reduce(
              (sum, value) => sum + value,
              0,
            ),
          }
        : {
            status: BuildkitCacheExportByteMeasurementStatus.Unavailable,
            reason: BuildkitCacheExportByteUnavailableReason.NotEmitted,
          };
    return {
      attempts: exportsByVertex.size,
      completed,
      byte_measurement: byteMeasurement,
      duration_ms: durationMs,
      incomplete_failures: incompleteFailures,
    };
  }
}

/** Owns precedence between structured and plain-progress export evidence. */
export class BuildkitCacheExportReconciler {
  /** @param {CacheExportSummary} structured */
  constructor(structured) {
    this.structured = structured;
  }

  /** @param {CacheExportSummary} plain @returns {CacheExportSummary} */
  reconcile(plain) {
    if (this.structured.attempts === 0) return plain;
    if (
      this.structured.byte_measurement.status ===
        BuildkitCacheExportByteMeasurementStatus.Unavailable &&
      plain.byte_measurement.status ===
        BuildkitCacheExportByteMeasurementStatus.Measured
    ) {
      return {
        ...this.structured,
        byte_measurement: plain.byte_measurement,
      };
    }
    return this.structured;
  }
}
