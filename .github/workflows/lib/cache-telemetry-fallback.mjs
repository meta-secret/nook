/** @typedef {import("./cache-telemetry-contracts.mjs").SccacheReport} SccacheReport */
/** @typedef {{state: 'active' | 'fallback', reason: string}} FallbackState */
const FALLBACK_MARKER = "NOOK_SCCACHE_FALLBACK ";

/** @param {string} text @returns {string | undefined} */
function rawFallbackReason(text) {
  let reason;
  for (const line of text.split(/\r?\n/)) {
    const markerAt = line.indexOf(FALLBACK_MARKER);
    if (markerAt === -1) continue;
    try {
      const fallback = JSON.parse(
        line.slice(markerAt + FALLBACK_MARKER.length).trim(),
      );
      reason =
        fallback && typeof fallback.reason === "string" && fallback.reason
          ? fallback.reason
          : "malformed_fallback_event";
    } catch {
      reason = "malformed_fallback_event";
    }
  }
  return reason;
}

/**
 * A raw-log fallback is current-solve evidence and always wins. A historical
 * circuit-open marker may be stale from a reused vertex, but only a healthy
 * authoritative terminal report from the same raw collection can supersede it.
 * Other fallback reasons remain fail-closed.
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
  if (
    historyFallback.state !== "fallback" ||
    historyFallback.reason !== "cache_circuit_open"
  )
    return historyFallback;
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
