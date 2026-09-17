import fs from "node:fs";

/** @typedef {import("./cache-telemetry-contracts.mjs").CacheTelemetryRecord} CacheTelemetryRecord */

/** Owns the concise cache telemetry section appended to the Actions job summary. */
export class CacheTelemetryJobSummary {
  /** @param {CacheTelemetryRecord} record */
  constructor(record) {
    this.record = record;
  }

  /** @param {string | undefined} [filename] @returns {void} */
  append(filename = process.env.GITHUB_STEP_SUMMARY) {
    if (!filename) return;
    const { record } = this;
    const compilerRate = !Number.isFinite(record.sccache.hit_rate_percent)
      ? "n/a (no executed cacheable compiler requests)"
      : `${record.sccache.hit_rate_percent}%`;
    const buildkitRate = !Number.isFinite(
      record.buildkit.cache_hit_rate_percent,
    )
      ? "n/a (no completed Buildx steps)"
      : `${record.buildkit.cache_hit_rate_percent}%`;
    const compilePhases = record.cache_scope.compile_phases;
    const compilePhaseSummary = compilePhases.foundation.requested
      ? [
          `- BuildKit compile Phase A: ${compilePhases.foundation.status}; ${compilePhases.foundation.cache_from.length} configured current/first-parent import refs; registry export=${compilePhases.foundation.cache_to.enabled ? "current-head mode=max" : "disabled"}; input access verified=${compilePhases.foundation.input_refs_access_verified}`,
          `- BuildKit compile Phase B: ${compilePhases.source_compile.status}; ${compilePhases.source_compile.cache_from.length} configured current-head import refs; registry export=disabled`,
        ]
      : [];
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
        ...compilePhaseSummary,
        `- Observed BuildKit registry exporter activity: ${record.buildkit.cache_export.bytes} bytes across ${record.buildkit.cache_export.completed}/${record.buildkit.cache_export.attempts} completed attempts in ${record.buildkit.cache_export.duration_ms} ms (${record.buildkit.cache_export.incomplete_failures} incomplete failures)`,
        "",
      ].join("\n"),
    );
  }
}
