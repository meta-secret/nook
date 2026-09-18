/** @typedef {import("./cache-telemetry-contracts.mjs").BuildHistoryBaseline} BuildHistoryBaselineRecord */
/** @typedef {import("./cache-telemetry-contracts.mjs").BuildHistoryRecord} BuildHistoryRecord */
/** @typedef {import("./cache-telemetry-contracts.mjs").JsonRecord} JsonRecord */

/** Owns Buildx history baseline publication and successor identity. */
export class BuildHistoryBaseline {
  /** @param {unknown} value @returns {value is JsonRecord} */
  static isJsonRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  /** @param {string} text @returns {unknown} */
  static parseJson(text) {
    return JSON.parse(text);
  }

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
    const parsed = BuildHistoryBaseline.parseJson(text);
    if (!BuildHistoryBaseline.isJsonRecord(parsed))
      throw new Error("expected a JSON object");
    const records = Array.isArray(parsed.records)
      ? parsed.records
          .filter((candidate) => BuildHistoryBaseline.isJsonRecord(candidate))
          .map(normalize)
      : [];
    const refs = Array.isArray(parsed.refs)
      ? parsed.refs.filter((ref) => typeof ref === "string")
      : [];
    const warnings = Array.isArray(parsed.warnings)
      ? parsed.warnings.filter((warning) => typeof warning === "string")
      : [];
    return { refs, records, warnings };
  }
}
