/**
 * Leveled application logger persisted in IndexedDB.
 *
 * Every entry is appended to the `nook_logs` database (ring buffer, newest
 * ~LOG_MAX_ENTRIES kept) regardless of console level, so post-mortem debugging
 * (e2e failures, user reports) can always read the full debug stream without
 * re-running with extra instrumentation.
 *
 * Console echo is gated by the active level:
 * - `localStorage.nook_log_level` (runtime override, e.g. from devtools/e2e)
 * - `VITE_LOG_LEVEL` (build-time default)
 * - fallback: `info`
 *
 * Global handle: `window.__nookLog` — `setLevel`, `dump`, `clear`.
 */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace'

const LEVEL_RANK: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
}

export type LogEntry = {
  ts: string
  level: LogLevel
  scope: string
  message: string
  data?: string
}

const LOG_DB_NAME = 'nook_logs'
const LOG_STORE = 'logs'
const LOG_MAX_ENTRIES = 5000
/** Trim overhead so we don't run a delete pass on every append. */
const LOG_TRIM_SLACK = 500

function parseLevel(raw: string | null | undefined): LogLevel | null {
  const value = raw?.trim().toLowerCase()
  if (
    value === 'error' ||
    value === 'warn' ||
    value === 'info' ||
    value === 'debug' ||
    value === 'trace'
  ) {
    return value
  }
  return null
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

let activeLevel: LogLevel = initialLevel()

function openLogDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LOG_DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(LOG_STORE)) {
        db.createObjectStore(LOG_STORE, { autoIncrement: true })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

let dbPromise: Promise<IDBDatabase> | null = null
function logDb(): Promise<IDBDatabase> {
  dbPromise ??= openLogDb().catch((error) => {
    dbPromise = null
    throw error
  })
  return dbPromise
}

/** Write-behind queue — appends never block or throw into callers. */
let pending: LogEntry[] = []
let flushScheduled = false
let approxCount = 0

async function flushPending(): Promise<void> {
  flushScheduled = false
  const batch = pending
  pending = []
  if (batch.length === 0) return
  try {
    const db = await logDb()
    const tx = db.transaction(LOG_STORE, 'readwrite')
    const store = tx.objectStore(LOG_STORE)
    for (const entry of batch) {
      store.add(entry)
    }
    approxCount += batch.length
    if (approxCount > LOG_MAX_ENTRIES + LOG_TRIM_SLACK) {
      await trimOldest(store)
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } catch {
    // Logging must never break the app; drop the batch on storage errors.
  }
}

async function trimOldest(store: IDBObjectStore): Promise<void> {
  const count = await requestAsPromise(store.count())
  approxCount = count
  const excess = count - LOG_MAX_ENTRIES
  if (excess <= 0) return
  await new Promise<void>((resolve) => {
    let deleted = 0
    const cursorReq = store.openCursor()
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result
      if (!cursor || deleted >= excess) {
        resolve()
        return
      }
      cursor.delete()
      deleted += 1
      cursor.continue()
    }
    cursorReq.onerror = () => resolve()
  })
  approxCount -= excess
}

function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function scheduleFlush() {
  if (flushScheduled) return
  flushScheduled = true
  setTimeout(() => void flushPending(), 250)
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
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    scope,
    message,
    data: serializeData(data),
  }
  pending.push(entry)
  scheduleFlush()

  if (LEVEL_RANK[level] <= LEVEL_RANK[activeLevel]) {
    const line = `[${scope}] ${message}`
    const args = entry.data === undefined ? [line] : [line, entry.data]
    if (level === 'error') console.error(...args)
    else if (level === 'warn') console.warn(...args)
    else console.log(...args)
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
  activeLevel = level
  try {
    localStorage.setItem('nook_log_level', level)
  } catch {
    // Storage may be unavailable (private mode); keep the in-memory level.
  }
}

export function getLogLevel(): LogLevel {
  return activeLevel
}

/** Read persisted entries (oldest first), optionally filtered by minimum level. */
export async function dumpLogs(options?: {
  minLevel?: LogLevel
  limit?: number
}): Promise<LogEntry[]> {
  await flushPending()
  const db = await logDb()
  const tx = db.transaction(LOG_STORE, 'readonly')
  const store = tx.objectStore(LOG_STORE)
  const all = await requestAsPromise(store.getAll())
  const maxRank = LEVEL_RANK[options?.minLevel ?? 'trace']
  const filtered = (all as LogEntry[]).filter(
    (entry) => LEVEL_RANK[entry.level] <= maxRank,
  )
  const limit = options?.limit ?? filtered.length
  return filtered.slice(-limit)
}

export async function clearLogs(): Promise<void> {
  pending = []
  const db = await logDb()
  const tx = db.transaction(LOG_STORE, 'readwrite')
  tx.objectStore(LOG_STORE).clear()
  approxCount = 0
  await new Promise<void>((resolve) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

declare global {
  interface Window {
    __nookLog?: {
      setLevel: typeof setLogLevel
      getLevel: typeof getLogLevel
      dump: typeof dumpLogs
      clear: typeof clearLogs
    }
  }
}

if (typeof window !== 'undefined') {
  window.__nookLog = {
    setLevel: setLogLevel,
    getLevel: getLogLevel,
    dump: dumpLogs,
    clear: clearLogs,
  }
}
