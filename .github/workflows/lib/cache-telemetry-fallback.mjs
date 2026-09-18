/** @typedef {import("./cache-telemetry-contracts.mjs").SccacheReport} SccacheReport */
/** @typedef {{state: 'active' | 'fallback', reason: string}} FallbackState */
/** @typedef {{reason?: unknown}} FallbackRecord */
const FALLBACK_MARKER = "NOOK_SCCACHE_FALLBACK ";

/** @param {unknown} value @returns {value is FallbackRecord} */
function isFallbackRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** @param {string} text @returns {unknown} */
function parseJson(text) {
  return JSON.parse(text);
}

/** @param {string} text @returns {FallbackRecord} */
function parseFallbackRecord(text) {
  const parsed = parseJson(text);
  if (!isFallbackRecord(parsed)) throw new Error("expected a JSON object");
  return parsed;
}

/** @param {string} text @returns {string | undefined} */
function rawFallbackReason(text) {
  /** @type {string | undefined} */
  let reason;
  for (const line of text.split(/\r?\n/)) {
    const markerAt = line.indexOf(FALLBACK_MARKER);
    if (markerAt === -1) continue;
    try {
      const fallback = parseFallbackRecord(
        line.slice(markerAt + FALLBACK_MARKER.length).trim(),
      );
      const fallbackReason = fallback.reason;
      reason =
        typeof fallbackReason === "string" && fallbackReason
          ? fallbackReason
          : "malformed_fallback_event";
    } catch {
      reason = "malformed_fallback_event";
    }
  }
  return reason;
}

/**
 * A raw-log fallback is current-solve evidence and always wins. A historical
 * fallback marker may be stale from a reused vertex, but only a healthy
 * authoritative terminal report from the same raw collection can supersede it.
 *
 * @param {readonly SccacheReport[]} rawReports
 * @param {FallbackState} rawFallback
 * @param {FallbackState} historyFallback
 * @param {string} [rawBuildLog]
 * @returns {FallbackState}
 */
export function resolveSccacheFallback(
  rawReports,
  rawFallback,
  historyFallback,
  rawBuildLog = "",
) {
  const rawReason = rawFallbackReason(rawBuildLog);
  if (rawReason) {
    return {
      state: "fallback",
      reason: rawReason,
    };
  }
  if (rawFallback.state === "fallback") return rawFallback;
  if (historyFallback.state !== "fallback") return historyFallback;
  const hasHealthyTerminal = rawReports.some(
    (report) =>
      report.counter_reliability === "authoritative" &&
      report.runtime_mode === "READ_WRITE" &&
      report.cache_errors === 0 &&
      report.cache_write_errors === 0 &&
      report.compile_failures === 0 &&
      (report.cache_hits > 0 || report.cache_misses > 0),
  );
  return hasHealthyTerminal
    ? { state: "active", reason: "none" }
    : historyFallback;
}
