/**
 * Web-side console authority + shim over the WASM-owned logger
 * (`nook-wasm/src/logger.rs`).
 *
 * The logger core — level gating, IndexedDB persistence (rexie, `nook_logs`
 * ring buffer), `nook-core`/`nook-wasm` `tracing` events — lives in WASM. This
 * module makes the WASM logger the single console authority for the web app:
 * - captures the ORIGINAL `console.*` methods at load,
 * - patches `console.*` so every call still prints (via the originals) AND is
 *   persisted through the `nookLog` binding,
 * - exposes `window.__nookConsole.echo` so Rust `tracing` events (already
 *   persisted by the WASM layer) print through the same original methods,
 * - forwards `createLogger(scope).info(…)` calls: echo once via the originals,
 *   then persist,
 * - resolves the initial level from `localStorage.nook_log_level` /
 *   `VITE_LOG_LEVEL`, drives the periodic flush, and exposes `window.__nookLog`.
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
  nookLogInit,
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
let consolePatched = false
let diagnosticsInstalled = false
const preInitQueue: PendingRecord[] = []

/**
 * The original console methods, captured before we patch `console`. All echo
 * paths (`createLogger`, the `console.*` patch, Rust via `__nookConsole.echo`)
 * print through these so patching never causes recursion or double-persist.
 */
type ConsoleMethod = (...args: unknown[]) => void
const originalConsole: Record<
  'error' | 'warn' | 'info' | 'debug' | 'log',
  ConsoleMethod
> =
  typeof console !== 'undefined'
    ? {
        error: console.error.bind(console),
        warn: console.warn.bind(console),
        info: console.info.bind(console),
        debug: console.debug.bind(console),
        log: console.log.bind(console),
      }
    : {
        error: () => {},
        warn: () => {},
        info: () => {},
        debug: () => {},
        log: () => {},
      }

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

/** Render arbitrary `console.*` arguments into a single persisted message. */
function stringifyArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === 'string') return arg
      if (arg instanceof Error)
        return arg.stack ?? `${arg.name}: ${arg.message}`
      try {
        return JSON.stringify(arg)
      } catch {
        return String(arg)
      }
    })
    .join(' ')
}

function levelRank(level: LogLevel): number {
  return LOG_LEVELS.indexOf(level)
}

/** Local `YYYY-MM-DD HH:MM:SS.mmm` timestamp for console echo lines. */
function formatTimestamp(date = new Date()): string {
  const pad = (value: number, size = 2) => String(value).padStart(size, '0')
  const y = date.getFullYear()
  const mo = pad(date.getMonth() + 1)
  const d = pad(date.getDate())
  const h = pad(date.getHours())
  const mi = pad(date.getMinutes())
  const s = pad(date.getSeconds())
  const ms = pad(date.getMilliseconds(), 3)
  return `${y}-${mo}-${d} ${h}:${mi}:${s}.${ms}`
}

/** True when `level` should be echoed/persisted under the active level. */
function isEnabled(level: LogLevel): boolean {
  return levelRank(level) <= levelRank(getLogLevel())
}

/**
 * Echo one line to the console via the ORIGINAL (unpatched) methods, prefixed
 * with a local date/time so console output is timestamped like the persisted
 * entries. Shared by `createLogger` and Rust `tracing` events
 * (`window.__nookConsole.echo`).
 */
function echo(level: LogLevel, text: string) {
  const line = `${formatTimestamp()} ${text}`
  switch (level) {
    case 'error':
      originalConsole.error(line)
      break
    case 'warn':
      originalConsole.warn(line)
      break
    case 'debug':
    case 'trace':
      originalConsole.debug(line)
      break
    default:
      originalConsole.info(line)
  }
}

/** Persist one entry (no console echo). Queues until WASM is ready. */
function persist(
  level: LogLevel,
  scope: string,
  message: string,
  serialized?: string,
) {
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

/** `createLogger` path: gate, echo once via originals, then persist. */
function record(
  level: LogLevel,
  scope: string,
  message: string,
  data?: unknown,
) {
  if (!isEnabled(level)) return
  const serialized = serializeData(data)
  const text = serialized
    ? `[${scope}] ${message} ${serialized}`
    : `[${scope}] ${message}`
  echo(level, text)
  persist(level, scope, message, serialized)
}

/** True for browser-extension scripts we should not persist as app errors. */
export function isIgnoredErrorSource(source: string | undefined): boolean {
  if (!source) return false
  const value = source.trim()
  if (!value) return false
  return (
    /^(chrome|moz|safari-web|safari)-extension:/i.test(value) ||
    value.includes('bootstrap-autofill-overlay')
  )
}

/** Strip query strings from URLs before persisting (tokens may appear in params). */
export function sanitizeLogUrl(url: string): string {
  try {
    const parsed = new URL(url, typeof location !== 'undefined' ? location.href : undefined)
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString()
  } catch {
    const withoutQuery = url.split('?')[0] ?? url
    return withoutQuery.split('#')[0] ?? withoutQuery
  }
}

function resolveFetchUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

/** Global `error` / `unhandledrejection` / non-OK `fetch` capture into app logs. */
function captureDiagnostic(
  level: LogLevel,
  scope: string,
  message: string,
  data?: unknown,
) {
  record(level, scope, message, data)
}

function installGlobalErrorHandlers() {
  if (typeof window === 'undefined') return

  window.addEventListener('error', (event) => {
    if (isIgnoredErrorSource(event.filename)) return
    captureDiagnostic('error', 'window', event.message || 'Uncaught error', {
      source: event.filename,
      line: event.lineno,
      column: event.colno,
      ...(event.error instanceof Error && event.error.stack
        ? { stack: event.error.stack }
        : {}),
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    const stack = reason instanceof Error ? reason.stack : undefined
    if (isIgnoredErrorSource(stack)) return
    const message =
      reason instanceof Error
        ? `${reason.name}: ${reason.message}`
        : stringifyArgs([reason])
    if (isIgnoredErrorSource(message)) return
    captureDiagnostic('error', 'unhandledrejection', message, stack ? { stack } : undefined)
  })
}

function installFetchInstrumentation() {
  if (typeof globalThis.fetch !== 'function') return
  const marker = globalThis as typeof globalThis & { __nookFetchPatched?: boolean }
  if (marker.__nookFetchPatched) return
  marker.__nookFetchPatched = true

  const originalFetch = globalThis.fetch.bind(globalThis)
  globalThis.fetch = async (input, init) => {
    const response = await originalFetch(input, init)
    if (!response.ok) {
      const url = sanitizeLogUrl(resolveFetchUrl(input))
      if (!isIgnoredErrorSource(url)) {
        captureDiagnostic('warn', 'fetch', `HTTP ${response.status} ${response.statusText}`, {
          url,
          status: response.status,
          method: init?.method ?? 'GET',
        })
      }
    }
    return response
  }
}

function installDiagnosticsCapture() {
  if (diagnosticsInstalled) return
  diagnosticsInstalled = true
  installGlobalErrorHandlers()
  installFetchInstrumentation()
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

/** Force the write-behind queue into IndexedDB (for `/logs`, e2e, post-mortem). */
export async function flushLogs(): Promise<void> {
  if (!wasmReady) return
  await nookLogFlush()
}

/**
 * Patch `console.*` so every call still prints (via the captured originals) and
 * is persisted with the `console` scope. Idempotent; only the persist side is
 * level-gated (console output is never suppressed).
 */
function patchConsole() {
  if (consolePatched || typeof console === 'undefined') return
  consolePatched = true

  const wrap = (
    method: 'error' | 'warn' | 'info' | 'debug' | 'log',
    level: LogLevel,
  ) => {
    console[method] = (...args: unknown[]) => {
      originalConsole[method](...args)
      if (isEnabled(level)) {
        persist(level, 'console', stringifyArgs(args))
      }
    }
  }

  wrap('error', 'error')
  wrap('warn', 'warn')
  wrap('info', 'info')
  wrap('debug', 'debug')
  wrap('log', 'info')
}

/**
 * Wire the WASM logger once the engine is initialised: install the console
 * bridge, start the Rust subscriber, push the resolved level, replay queued
 * entries, and start the write-behind flush loop.
 * Idempotent — safe to call on every `getVaultManager()`.
 */
export function initWasmLogging() {
  if (typeof window !== 'undefined') {
    window.__nookConsole = { echo }
  }
  installDiagnosticsCapture()
  patchConsole()

  nookLogInit()
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
      flush: typeof flushLogs
    }
    /** Bridge for Rust `tracing` events to reach the original console. */
    __nookConsole?: {
      echo: (level: LogLevel, text: string) => void
    }
  }
}

if (typeof window !== 'undefined') {
  installDiagnosticsCapture()
  window.__nookLog = {
    setLevel: setLogLevel,
    getLevel: getLogLevel,
    dump: dumpLogs,
    count: logCount,
    clear: clearLogs,
    flush: flushLogs,
  }
}
