/**
 * Thin web-side shim over the WASM-owned logger (`nook-wasm/src/logger.rs`).
 *
 * The logger itself — level gating, IndexedDB persistence (rexie, `nook_logs`
 * ring buffer), console echo — lives in WASM. This module only:
 * - forwards `createLogger(scope).info(…)` calls to the `nookLog` binding,
 * - resolves the initial level from `localStorage.nook_log_level` /
 *   `VITE_LOG_LEVEL` and pushes it into WASM,
 * - drives the periodic flush of the write-behind queue,
 * - exposes `window.__nookLog` for devtools / e2e / the `/logs` page.
 *
 * Persistence is level-gated: only entries at or above the active level are
 * stored. For a deeper post-mortem, lower the level (`debug`/`trace`) and
 * reproduce — nothing below the threshold is kept.
 *
 * Calls made before WASM is initialised are queued and replayed by
 * {@link initWasmLogging} (invoked once from `$lib/nook`).
 */

import {
  nookLog,
  nookLogClear,
  nookLogCount,
  nookLogDump,
  nookLogFlush,
  nookLogGetLevel,
  nookLogSetLevel,
} from './nook-wasm/nook_wasm'

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace'

export type LogEntry = {
  ts: string
  level: LogLevel
  scope: string
  message: string
  data?: string
}

const LOG_LEVELS: readonly LogLevel[] = [
  'error',
  'warn',
  'info',
  'debug',
  'trace',
]

/** How long to run the write-behind flush loop between IndexedDB writes. */
const FLUSH_INTERVAL_MS = 250
/** Cap the pre-init replay queue so early crash loops can't grow unbounded. */
const PRE_INIT_QUEUE_MAX = 1000

type PendingRecord = {
  level: LogLevel
  scope: string
  message: string
  data?: string
}

let wasmReady = false
let flushTimer: ReturnType<typeof setInterval> | null = null
let flushing = false
const preInitQueue: PendingRecord[] = []

function parseLevel(raw: string | null | undefined): LogLevel | null {
  const value = raw?.trim().toLowerCase()
  return LOG_LEVELS.includes(value as LogLevel) ? (value as LogLevel) : null
}

function initialLevel(): LogLevel {
  if (typeof localStorage !== 'undefined') {
    const stored = parseLevel(localStorage.getItem('nook_log_level'))
    if (stored) return stored
  }
  const env =
    typeof import.meta !== 'undefined'
      ? parseLevel(import.meta.env?.VITE_LOG_LEVEL as string | undefined)
      : null
  return env ?? 'info'
}

function serializeData(data: unknown): string | undefined {
  if (data === undefined) return undefined
  try {
    return typeof data === 'string' ? data : JSON.stringify(data)
  } catch {
    return String(data)
  }
}

function record(
  level: LogLevel,
  scope: string,
  message: string,
  data?: unknown,
) {
  const serialized = serializeData(data)
  if (!wasmReady) {
    if (preInitQueue.length < PRE_INIT_QUEUE_MAX) {
      preInitQueue.push({ level, scope, message, data: serialized })
    }
    return
  }
  try {
    nookLog(level, scope, message, serialized ?? undefined)
  } catch {
    // Logging must never break the app.
  }
}

export type ScopedLogger = {
  error: (message: string, data?: unknown) => void
  warn: (message: string, data?: unknown) => void
  info: (message: string, data?: unknown) => void
  debug: (message: string, data?: unknown) => void
  trace: (message: string, data?: unknown) => void
}

export function createLogger(scope: string): ScopedLogger {
  return {
    error: (message, data) => record('error', scope, message, data),
    warn: (message, data) => record('warn', scope, message, data),
    info: (message, data) => record('info', scope, message, data),
    debug: (message, data) => record('debug', scope, message, data),
    trace: (message, data) => record('trace', scope, message, data),
  }
}

export function setLogLevel(level: LogLevel) {
  try {
    localStorage.setItem('nook_log_level', level)
  } catch {
    // Storage may be unavailable (private mode); keep the WASM-side level.
  }
  if (wasmReady) {
    nookLogSetLevel(level)
  }
}

export function getLogLevel(): LogLevel {
  if (wasmReady) {
    return parseLevel(nookLogGetLevel()) ?? 'info'
  }
  return initialLevel()
}

/** Read persisted entries (oldest first), optionally filtered/paginated. */
export async function dumpLogs(options?: {
  minLevel?: LogLevel
  limit?: number
  offset?: number
}): Promise<LogEntry[]> {
  if (!wasmReady) return []
  const entries = (await nookLogDump(
    options?.minLevel ?? undefined,
    options?.limit ?? undefined,
    options?.offset ?? undefined,
  )) as LogEntry[]
  return entries ?? []
}

/** Total number of persisted log entries. */
export async function logCount(): Promise<number> {
  if (!wasmReady) return 0
  return nookLogCount()
}

export async function clearLogs(): Promise<void> {
  if (!wasmReady) return
  await nookLogClear()
}

/**
 * Wire the WASM logger once the engine is initialised: push the resolved
 * level, replay queued entries, and start the write-behind flush loop.
 * Idempotent — safe to call on every `getVaultManager()`.
 */
export function initWasmLogging() {
  nookLogSetLevel(initialLevel())
  wasmReady = true

  if (preInitQueue.length > 0) {
    const queued = preInitQueue.splice(0, preInitQueue.length)
    for (const entry of queued) {
      try {
        nookLog(
          entry.level,
          entry.scope,
          entry.message,
          entry.data ?? undefined,
        )
      } catch {
        // Ignore — a broken early log must not block startup.
      }
    }
  }

  if (!flushTimer) {
    flushTimer = setInterval(() => {
      if (flushing) return
      flushing = true
      void nookLogFlush()
        .catch(() => {
          // Drop the batch on storage errors; logging must never break the app.
        })
        .finally(() => {
          flushing = false
        })
    }, FLUSH_INTERVAL_MS)
  }
}

declare global {
  interface Window {
    __nookLog?: {
      setLevel: typeof setLogLevel
      getLevel: typeof getLogLevel
      dump: typeof dumpLogs
      count: typeof logCount
      clear: typeof clearLogs
    }
  }
}

if (typeof window !== 'undefined') {
  window.__nookLog = {
    setLevel: setLogLevel,
    getLevel: getLogLevel,
    dump: dumpLogs,
    count: logCount,
    clear: clearLogs,
  }
}
