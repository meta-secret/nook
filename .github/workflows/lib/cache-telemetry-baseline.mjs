/** @typedef {import("./cache-telemetry-contracts.mjs").BuildHistoryBaseline} BuildHistoryBaselineRecord */
/** @typedef {import("./cache-telemetry-contracts.mjs").BuildHistoryRecord} BuildHistoryRecord */

/** Owns Buildx history baseline publication and successor identity. */
export class BuildHistoryBaseline {
  /** @param {BuildHistoryRecord} record @returns {string} */
  static identity(record) {
    return [
      record.ref,
      record.name,
      record.status,
      record.started_at || "",
      record.completed_at || "",
    ].join("\u001f");
  }

  /**
   * @param {{text: string, normalize: (record: Record<string, unknown>) => BuildHistoryRecord}} request
   * @returns {BuildHistoryBaselineRecord}
   */
  static parse({ text, normalize }) {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("expected a JSON object");
    const record = /** @type {Record<string, unknown>} */ (parsed);
    const records = Array.isArray(record.records)
      ? record.records
          .filter(
            (candidate) =>
              Boolean(candidate) &&
              typeof candidate === "object" &&
              !Array.isArray(candidate),
          )
          .map((candidate) =>
            normalize(/** @type {Record<string, unknown>} */ (candidate)),
          )
      : [];
    const refs = Array.isArray(record.refs)
      ? record.refs.filter((ref) => typeof ref === "string")
      : [];
    const warnings = Array.isArray(record.warnings)
      ? record.warnings.filter((warning) => typeof warning === "string")
      : [];
    return { refs, records, warnings };
  }
}
