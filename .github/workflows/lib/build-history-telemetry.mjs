import { spawn, spawnSync } from "node:child_process";

/** @typedef {import("./cache-telemetry-contracts.mjs").JsonRecord} JsonRecord */
/** @typedef {import("./cache-telemetry-contracts.mjs").RawJsonProgress} RawJsonProgress */

const HISTORY_LOG_TIMEOUT_MS = 12_000;

/** Owns Buildx history JSON decoding and history-log collection. */
export class BuildHistoryTelemetry {
  /** @param {unknown} value @returns {value is JsonRecord} */
  static isJsonRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  /** @param {string} text @returns {unknown} */
  static parseJson(text) {
    return JSON.parse(text);
  }

  /** @param {string} text @returns {JsonRecord} */
  static parseJsonRecord(text) {
    const parsed = BuildHistoryTelemetry.parseJson(text);
    if (!BuildHistoryTelemetry.isJsonRecord(parsed))
      throw new Error("expected a JSON object");
    return parsed;
  }

  /** @param {string} text @returns {JsonRecord[]} */
  static parseJsonObjects(text) {
    const trimmed = text.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[")) {
      const parsed = BuildHistoryTelemetry.parseJson(trimmed);
      if (!Array.isArray(parsed)) {
        throw new Error("expected a JSON object array");
      }
      const candidates = parsed.filter((candidate) =>
        BuildHistoryTelemetry.isJsonRecord(candidate),
      );
      if (candidates.length !== parsed.length) {
        throw new Error("expected a JSON object array");
      }
      return candidates;
    }
    return trimmed
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => BuildHistoryTelemetry.parseJsonRecord(line));
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
        const parsed = BuildHistoryTelemetry.parseJson(line);
        if (Array.isArray(parsed)) {
          const candidates = parsed.filter((candidate) =>
            BuildHistoryTelemetry.isJsonRecord(candidate),
          );
          if (candidates.length === parsed.length) {
            objects.push(...candidates);
          } else {
            diagnostics.push(line);
          }
        } else if (BuildHistoryTelemetry.isJsonRecord(parsed)) {
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

  /** @param {string} ref @returns {string} */
  static historyLogRef(ref) {
    const [historyRef = ""] = [String(ref).split("/").filter(Boolean).pop()];
    return historyRef;
  }

  /** @returns {JsonRecord[]} */
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
    return BuildHistoryTelemetry.parseJsonObjects(result.stdout);
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
        BuildHistoryTelemetry.historyLogRef(ref),
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
        const parsedStdout = BuildHistoryTelemetry.parseRawJsonProgress(stdout);
        const parsedStderr = BuildHistoryTelemetry.parseRawJsonProgress(stderr);
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
}
