import { type Page } from '@playwright/test'
import fs from 'node:fs/promises'
import { LogLevel } from '../../../nook-web-shared/src/vault-app/lib/runtime/log-level'

export type NookLogEntry = {
  ts: string
  level: string
  scope: string
  message: string
  data?: string
}

type AppLogWindow = Window & {
  __nookLog?: {
    dump: (query: {
      minLevel: LogLevel
      limit: number
      offset: number
    }) => Promise<NookLogEntry[]>
    count: () => Promise<number>
    flush: () => Promise<void>
    getLevel: () => LogLevel
  }
}

const APP_LOGS_SCHEMA = 'nook.app-logs.v1' as const
const APP_LOGS_ATTACHMENT_LIMIT = 5000
const APP_LOGS_FAILURE_PRINT_LIMIT = 500

function parseLogLevel(value?: string): LogLevel {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  switch (normalized) {
    case LogLevel.Error:
      return LogLevel.Error
    case LogLevel.Warn:
      return LogLevel.Warn
    case LogLevel.Info:
      return LogLevel.Info
    case LogLevel.Debug:
      return LogLevel.Debug
    case LogLevel.Trace:
      return LogLevel.Trace
    default:
      return LogLevel.Trace
  }
}

type AppLogsResponse = {
  meta: {
    schema: typeof APP_LOGS_SCHEMA
    generatedAt: string
    activeLevel: string
    minLevel: string
    limit: number
    offset: number
    returned: number
    total: number
  }
  entries: NookLogEntry[]
}

type AppLogsJsonValue =
  | AppLogsResponse
  | AppLogsResponse['meta']
  | NookLogEntry
  | NookLogEntry[]
  | string
  | number

export /** Read persisted app log entries when the runtime hook is available. */
async function readNookLogEntries(
  page: Page,
  limit: number,
): Promise<NookLogEntry[]> {
  return page.evaluate<NookLogEntry[], { lim: number; minLevel: LogLevel }>(
    async ({ lim, minLevel }) => {
      const log = (window as AppLogWindow).__nookLog
      if (!log) throw new Error('__nookLog is not available on the page')
      return log.dump({
        minLevel,
        limit: lim,
        offset: 0,
      })
    },
    { lim: limit, minLevel: LogLevel.Trace },
  )
}

export async function readNookLogSnapshot(
  page: Page,
  options?: { minLevel?: string; limit?: number; offset?: number },
): Promise<AppLogsResponse> {
  const query = {
    schema: APP_LOGS_SCHEMA,
    minLevel: parseLogLevel(options?.minLevel),
    limit: ((...[v = APP_LOGS_ATTACHMENT_LIMIT]) => v)(options?.limit),
    offset: ((v) => (v ? v : 0))(options?.offset),
  }
  return page.evaluate(async (opts) => {
    const log = (window as AppLogWindow).__nookLog
    if (!log) throw new Error('__nookLog is not available on the page')
    await log.flush()
    const [total, entries] = await Promise.all([
      log.count(),
      log.dump({
        minLevel: opts.minLevel,
        limit: opts.limit,
        offset: opts.offset,
      }),
    ])
    return {
      meta: {
        schema: opts.schema,
        generatedAt: new Date().toISOString(),
        activeLevel: log.getLevel(),
        minLevel: opts.minLevel,
        limit: opts.limit,
        offset: opts.offset,
        returned: entries.length,
        total,
      },
      entries,
    }
  }, query)
}

export function printNookLogEntries(label: string, entries: NookLogEntry[]) {
  console.log(`[${label}] last ${entries.length} app log entries:`)
  for (const entry of entries) {
    const data = entry.data ? ` ${entry.data}` : ''
    console.log(
      `  ${entry.ts} ${entry.level.toUpperCase()} [${entry.scope}] ${entry.message}${data}`,
    )
  }
}

/** Read persisted app log entries when the runtime hook is available. */
export async function readPersistedAppLogs(
  page: Page,
  limit = 500,
): Promise<NookLogEntry[]> {
  return readNookLogEntries(page, limit)
}

/**
 * Attach a canonical `/app-logs`-style JSON payload to a Playwright test result.
 * Prints the same entries only when requested by the caller. Wired globally via
 * the {@link file://./fixtures.ts} auto fixture — no per-spec `afterEach` needed.
 * Never throws.
 */
export async function attachNookLogsForTest(
  page: Page,
  testInfo: import('@playwright/test').TestInfo,
  options?: {
    attachmentName?: string
    print?: boolean
  },
) {
  try {
    const payload = await readNookLogSnapshot(page, {
      minLevel: 'trace',
      limit: APP_LOGS_ATTACHMENT_LIMIT,
      offset: 0,
    })
    if (options?.print && payload.entries.length > 0) {
      printNookLogEntries(
        `nook-logs] [${testInfo.title}`,
        payload.entries.slice(-APP_LOGS_FAILURE_PRINT_LIMIT),
      )
    }
    const body = JSON.stringify(
      payload,
      (_key: string, value: AppLogsJsonValue): AppLogsJsonValue => value,
      2,
    )
    const attachmentName =
      options && options.attachmentName
        ? options.attachmentName
        : NookAppLogAttachmentName.Primary
    const attachmentPath = testInfo.outputPath(attachmentName)
    await fs.writeFile(attachmentPath, body)
    await testInfo.attach(attachmentName, {
      path: attachmentPath,
      contentType: 'application/json',
    })
  } catch {
    // Post-mortem logging must never fail the run.
  }
}

export enum NookAppLogAttachmentName {
  Joiner = 'joiner-nook-app-logs.json',
  Primary = 'nook-app-logs.json',
}
