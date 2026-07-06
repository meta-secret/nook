import {
  dumpLogs,
  getLogLevel,
  logCount,
  type LogEntry,
  type LogLevel,
} from '$lib/log'
import { stripBasePath } from '$lib/routes'

/** Machine-readable log export route (JSON body, not the human `/logs` viewer). */
export const APP_LOGS_PATH = '/app-logs'

export const APP_LOGS_SCHEMA = 'nook.app-logs.v1' as const

export type AppLogsQuery = {
  minLevel: LogLevel
  limit: number
  offset: number
}

export type AppLogsResponse = {
  meta: {
    schema: typeof APP_LOGS_SCHEMA
    generatedAt: string
    activeLevel: LogLevel
    minLevel: LogLevel
    limit: number
    offset: number
    returned: number
    total: number
  }
  entries: LogEntry[]
}

const LOG_LEVELS: readonly LogLevel[] = [
  'error',
  'warn',
  'info',
  'debug',
  'trace',
]

function parseLevel(raw: string | undefined, fallback: LogLevel): LogLevel {
  const value = raw?.trim().toLowerCase()
  return LOG_LEVELS.includes(value as LogLevel) ? (value as LogLevel) : fallback
}

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  max: number,
) {
  const parsed = Number.parseInt(raw ?? '', 10)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return Math.min(parsed, max)
}

/** True when the current location resolves to the `/app-logs` JSON export route. */
export function isAppLogsPath(pathname: string): boolean {
  const normalized = stripBasePath(pathname).replace(/\/$/, '') || '/'
  return normalized === APP_LOGS_PATH
}

/** Parse `/app-logs?minLevel=debug&limit=500&offset=0` query parameters. */
export function parseAppLogsQuery(search: string): AppLogsQuery {
  const params = new URLSearchParams(
    search.startsWith('?') ? search.slice(1) : search,
  )
  return {
    minLevel: parseLevel(params.get('minLevel') ?? undefined, 'trace'),
    limit: parsePositiveInt(params.get('limit') ?? undefined, 500, 5000),
    offset: parsePositiveInt(
      params.get('offset') ?? undefined,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
  }
}

export function buildAppLogsUrl(
  query: Partial<AppLogsQuery> = {},
  basePath = APP_LOGS_PATH,
): string {
  const params = new URLSearchParams()
  if (query.minLevel) params.set('minLevel', query.minLevel)
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.offset !== undefined) params.set('offset', String(query.offset))
  const qs = params.toString()
  return qs ? `${basePath}?${qs}` : basePath
}

/** Load persisted entries and wrap them in the canonical JSON export envelope. */
export async function loadAppLogsResponse(
  query: AppLogsQuery,
): Promise<AppLogsResponse> {
  const [total, entries] = await Promise.all([
    logCount(),
    dumpLogs({
      minLevel: query.minLevel,
      limit: query.limit,
      offset: query.offset,
    }),
  ])

  return {
    meta: {
      schema: APP_LOGS_SCHEMA,
      generatedAt: new Date().toISOString(),
      activeLevel: getLogLevel(),
      minLevel: query.minLevel,
      limit: query.limit,
      offset: query.offset,
      returned: entries.length,
      total,
    },
    entries,
  }
}
