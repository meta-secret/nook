/** @typedef {Record<string, unknown>} JsonRecord */
/** @typedef {{ref: string, name: string, status: string, completed_steps: number, total_steps: number, cached_steps: number, started_at?: string, completed_at?: string, cache_hit_rate_percent?: number}} BuildHistoryRecord */
/** @typedef {{stage: string, baked_runtime_mode: 'READ_WRITE', runtime_mode: 'READ_WRITE', runtime_mode_source: 'environment' | 'runtime_secret', client_side: boolean, counter_reliability: 'authoritative' | 'backend_incomplete', publication_status: 'pending_verification' | 'counters_observed', compile_requests: number, requests_executed: number, cache_hits: number, cache_misses: number, cache_errors: number, cache_write_errors: number, cache_writes: number, remote_writes: number, compile_failures: number}} SccacheReport */
/** @typedef {{report_count: number, baked_runtime_mode: 'READ_WRITE' | 'UNAVAILABLE', runtime_mode: 'READ_WRITE' | 'UNAVAILABLE', runtime_mode_source: 'environment' | 'runtime_secret' | 'unavailable', client_side: boolean, counter_reliability: 'authoritative' | 'backend_incomplete' | 'unavailable', publication_status: 'pending_verification' | 'counters_observed' | 'unavailable', compile_requests: number, requests_executed: number, cache_hits: number, cache_misses: number, cache_errors: number, cache_write_errors: number, cache_writes: number, remote_writes: number, compile_failures: number, measurement: 'sum_of_zero_based_run_snapshots', fallback: {state: 'active' | 'fallback', reason: string}, snapshots: readonly SccacheReport[], hit_rate_percent?: number}} SccacheSummary */
/** @typedef {{status: 'measured', bytes: number}} MeasuredBuildkitCacheExportBytes */
/** @typedef {{status: 'unavailable', reason: 'buildkit_did_not_emit_byte_count'}} UnavailableBuildkitCacheExportBytes */
/** @typedef {MeasuredBuildkitCacheExportBytes | UnavailableBuildkitCacheExportBytes} BuildkitCacheExportByteMeasurement */
/** @typedef {{build_record_count: number, completed_steps: number, cached_steps: number, cache_hit_rate_percent?: number, cache_export: {attempts: number, completed: number, byte_measurement: BuildkitCacheExportByteMeasurement, duration_ms: number, incomplete_failures: number}, measurement: 'buildx_target_record_steps'}} BuildkitSummary */
/** @typedef {{kind: 'remote' | 'direct_compile', persistent: boolean, reason: string}} CacheBackend */
/** @typedef {'not_requested' | 'not_started' | 'running' | 'completed' | 'failed'} CompilePhaseStatus */
/** @typedef {{enabled: boolean, ref: string, mode: 'max' | 'disabled'}} CompilePhaseCacheExport */
/** @typedef {{requested: boolean, target: string, status: CompilePhaseStatus, cache_from: readonly string[], cache_to: CompilePhaseCacheExport, input_refs_access_verified?: boolean}} CompileFoundationPhase */
/** @typedef {{requested: boolean, target: string, status: CompilePhaseStatus, cache_from: readonly string[], cache_to: CompilePhaseCacheExport}} CompileSourcePhase */
/** @typedef {{foundation: CompileFoundationPhase, source_compile: CompileSourcePhase}} CompilePhaseSummary */
/** @typedef {{scope: string, compile_dependencies: {scope: string, available: boolean, write_enabled: boolean, export_enabled: boolean}, compile_source: {scope: string, parent_scope_suffix: string, parent_ref: string}, compile_phases: CompilePhaseSummary, imports: {probes_complete: boolean, failure_class: string, availability: Array<{name: string, available: boolean}>}}} CacheScopeSummary */
/** @typedef {{schema_version: 2, github: {run_id: string, run_attempt: number, job: string}, cache_backend: CacheBackend, cache_scope: CacheScopeSummary, sccache: SccacheSummary, buildkit: BuildkitSummary, buildkit_records: readonly BuildHistoryRecord[], collection: {complete: boolean, warnings: readonly string[], failures: readonly CollectionFailure[]}}} CacheTelemetryRecord */
/** @typedef {{component: 'buildx_history' | 'buildx_logs' | 'buildkit_cache_export' | 'collector', reference: string, message: string}} CollectionFailure */
/** @typedef {{objects: readonly JsonRecord[], diagnostics: readonly string[]}} RawJsonProgress */
/** @typedef {{runId?: string | number, runAttempt?: string | number}} TelemetryIdentityExpectation */
/** @typedef {{baselineRefs: readonly string[], baselineRecords?: readonly BuildHistoryRecord[], baselineWarnings?: readonly string[], job?: string, runId?: string | number, runAttempt?: string | number, environment?: NodeJS.ProcessEnv}} CollectTelemetryRequest */
/** @typedef {{refs: readonly string[], records?: readonly BuildHistoryRecord[], warnings: readonly string[]}} BuildHistoryBaseline */
/** @typedef {{warning: string, job?: string, runId?: string | number, runAttempt?: string | number, environment?: NodeJS.ProcessEnv}} UnavailableTelemetryRequest */

export {};
