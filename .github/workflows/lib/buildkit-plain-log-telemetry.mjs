import {
  BuildkitCacheExportByteMeasurementStatus,
  BuildkitCacheExportByteUnavailableReason,
} from "./buildkit-cache-export-telemetry.mjs";

/** Owns cache-export telemetry decoded from BuildKit's plain progress stream. */
/** @typedef {{completed: boolean, failed: boolean, duration_ms: number, transfers: Map<string, number>}} PlainCacheExport */
export class BuildkitPlainLogTelemetry {
  /** @param {string} text */
  constructor(text) {
    this.text = text;
  }

  /** @param {string} value @returns {number} */
  byteCount(value) {
    const match = /^(\d+(?:\.\d+)?)(B|kB|MB|GB)$/.exec(value);
    if (!match) return 0;
    const [, amountText = "0", unit = "B"] = match;
    const amount = Number(amountText);
    const multiplier =
      unit === "GB"
        ? 1_000_000_000
        : unit === "MB"
          ? 1_000_000
          : unit === "kB"
            ? 1_000
            : 1;
    return Math.round(amount * multiplier);
  }

  summary() {
    /** @type {Map<string, PlainCacheExport>} */
    const exportsByVertex = new Map();
    for (const line of this.text.split(/\r?\n/)) {
      const plainLine = line.replace(/\x1b\[[0-9;]*m/g, "").trim();
      const vertexMatch = /^(#[0-9]+)\s+(.*)$/.exec(plainLine);
      if (!vertexMatch) continue;
      const [, vertex = "", detailRaw = ""] = vertexMatch;
      const detail = detailRaw.replace(/^\d+(?:\.\d+)?\s+/, "");
      if (/^exporting cache to registry\b/i.test(detail)) {
        exportsByVertex.set(vertex, {
          completed: false,
          failed: false,
          duration_ms: 0,
          transfers: new Map(),
        });
        continue;
      }
      const cacheExport = exportsByVertex.get(vertex);
      if (!cacheExport) continue;
      if (/\b(?:ERROR|CANCELED)\b/i.test(detail)) cacheExport.failed = true;
      const transfer =
        /^(?:writing|pushing|uploading)\s+(.+?)\s+(\d+(?:\.\d+)?(?:B|kB|MB|GB))(?:\s*\/\s*\d+(?:\.\d+)?(?:B|kB|MB|GB))?\b/i.exec(
          detail,
        );
      if (transfer) {
        const [, transferName = "", transferBytes = "0B"] = transfer;
        const bytes = this.byteCount(transferBytes);
        if (bytes <= 0) continue;
        cacheExport.transfers.set(
          transferName,
          Math.max(cacheExport.transfers.get(transferName) || 0, bytes),
        );
      }
      const completed = /^DONE\s+(\d+(?:\.\d+)?)s\b/.exec(detail);
      if (completed) {
        const [, durationSeconds = "0"] = completed;
        cacheExport.completed = !cacheExport.failed;
        cacheExport.duration_ms = Math.round(Number(durationSeconds) * 1000);
      }
    }
    let completed = 0;
    let bytes = 0;
    let measuredTransferCount = 0;
    let durationMs = 0;
    let incompleteFailures = 0;
    for (const cacheExport of exportsByVertex.values()) {
      if (cacheExport.completed) completed += 1;
      if (cacheExport.failed || !cacheExport.completed) incompleteFailures += 1;
      durationMs += cacheExport.duration_ms;
      for (const transferBytes of cacheExport.transfers.values()) {
        bytes += transferBytes;
        measuredTransferCount += 1;
      }
    }
    return {
      attempts: exportsByVertex.size,
      completed,
      byte_measurement:
        measuredTransferCount > 0
          ? {
              status: BuildkitCacheExportByteMeasurementStatus.Measured,
              bytes,
            }
          : {
              status: BuildkitCacheExportByteMeasurementStatus.Unavailable,
              reason: BuildkitCacheExportByteUnavailableReason.NotEmitted,
            },
      duration_ms: durationMs,
      incomplete_failures: incompleteFailures,
    };
  }
}
