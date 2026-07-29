import {
  EMPTY_VALUE,
  omittedValue,
  presentValue,
  type ValueState,
} from '../../../nook-web-shared/src/explicit-state'
import { expect, type Page } from '@playwright/test'
import fs from 'node:fs/promises'
import { UI_TIMEOUT_MS } from './environment'

export type NookLogEntry = {
  ts: string
  level: string
  scope: string
  message: string
  data?: string
}

const APP_LOGS_SCHEMA = 'nook.app-logs.v1' as const
const APP_LOGS_ATTACHMENT_LIMIT = 5000
const APP_LOGS_FAILURE_PRINT_LIMIT = 500

function buildAppLogsUrl(options?: {
  minLevel?: string
  limit?: number
  offset?: number
}): string {
  const params = new URLSearchParams()
  if (options?.minLevel) params.set('minLevel', options.minLevel)
  if (typeof options?.limit !== 'undefined')
    params.set('limit', String(options.limit))
  if (typeof options?.offset !== 'undefined') {
    params.set('offset', String(options.offset))
  }
  const query = params.toString()
  return query ? `/app-logs?${query}` : '/app-logs'
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

export /** Read persisted app log entries (`window.__nookLog`) from the page, or undefined. */
async function readNookLogEntries(
  page: Page,
  limit: number,
): Promise<NookLogEntry[] | void> {
  return page.evaluate(async (lim) => {
    const log = (
      window as Window & {
        __nookLog?: {
          dump: (opts?: { limit?: number }) => Promise<
            {
              ts: string
              level: string
              scope: string
              message: string
              data?: string
            }[]
          >
        }
      }
    ).__nookLog
    if (!log) return
    return log.dump({ limit: lim })
  }, limit)
}

export async function readNookLogSnapshot(
  page: Page,
  options?: { minLevel?: string; limit?: number; offset?: number },
): Promise<AppLogsResponse | void> {
  const query = {
    schema: APP_LOGS_SCHEMA,
    minLevel: options?.minLevel ?? 'trace',
    limit: options?.limit ?? APP_LOGS_ATTACHMENT_LIMIT,
    offset: options?.offset ?? 0,
  }
  return page.evaluate(async (opts) => {
    const log = (
      window as Window & {
        __nookLog?: {
          flush: () => Promise<void>
          getLevel: () => string
          count: () => Promise<number>
          dump: (opts?: {
            minLevel?: string
            limit?: number
            offset?: number
          }) => Promise<
            {
              ts: string
              level: string
              scope: string
              message: string
              data?: string
            }[]
          >
        }
      }
    ).__nookLog
    if (!log) return
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

/**
 * Fetch persisted app logs via the `/app-logs` JSON export route.
 * Prefer this over ad-hoc `page.evaluate` when debugging e2e failures.
 */
export async function fetchAppLogs(
  page: Page,
  options?: {
    minLevel?: string
    limit?: number
    offset?: number
  },
): Promise<AppLogsResponse> {
  const url = buildAppLogsUrl(options)
  await page.goto(url)
  const json = page.getByTestId('app-logs-json')
  await expect(json).toBeVisible({ timeout: UI_TIMEOUT_MS })
  const text = await json.textContent()
  if (!text) {
    throw new Error('`/app-logs` returned an empty JSON body')
  }
  const payload = JSON.parse(text) as AppLogsResponse
  if (payload.meta?.schema !== APP_LOGS_SCHEMA) {
    throw new Error(
      `Unexpected /app-logs schema: ${String(payload.meta?.schema)}`,
    )
  }
  return payload
}

/** Read persisted app log entries (`window.__nookLog`) from the page, or undefined. */
export async function readPersistedAppLogs(
  page: Page,
  limit = 500,
): Promise<NookLogEntry[] | void> {
  return readNookLogEntries(page, limit)
}

/** Drain the in-memory log queue into IndexedDB before reading `/logs` or `/app-logs`. */
export async function flushNookLogPersistQueue(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const log = (
      window as Window & { __nookLog?: { flush: () => Promise<void> } }
    ).__nookLog
    await log?.flush()
  })
}

export async function waitForPersistedAppLog(
  page: Page,
  filter: {
    scope?: string
    level?: string
    messageIncludes?: string
  },
  options?: { limit?: number; timeoutMs?: number },
): Promise<NookLogEntry> {
  let foundState: ValueState<NookLogEntry> = EMPTY_VALUE
  await expect
    .poll(
      async () => {
        await flushNookLogPersistQueue(page)
        const entries = await readNookLogEntries(page, options?.limit ?? 500)
        const found = findAppLogEntry(entries ?? [], filter)
        foundState =
          typeof found === 'undefined' ? EMPTY_VALUE : presentValue(found)
        return found
      },
      { timeout: options?.timeoutMs ?? UI_TIMEOUT_MS * 2 },
    )
    .not.toBeUndefined()
  if (foundState.kind === 'empty') {
    throw new Error('persisted app log poll completed without a matching entry')
  }
  return foundState.value
}

/** Wait for each persisted log milestone in order (see `.cortex/references/logging.md`). */
export async function expectAppLogMilestones(
  page: Page,
  milestones: Array<{
    scope?: string
    level?: string
    messageIncludes: string
  }>,
  options?: { limit?: number; timeoutMs?: number },
): Promise<void> {
  let lastEntries: NookLogEntry[] = []
  await expect
    .poll(
      async () => {
        await flushNookLogPersistQueue(page)
        lastEntries =
          (await readNookLogEntries(page, options?.limit ?? 500)) ?? []
        return appLogMilestonesAreInOrder(lastEntries, milestones)
      },
      { timeout: options?.timeoutMs ?? UI_TIMEOUT_MS * 2 },
    )
    .toBe(true)

  expect(
    appLogMilestonesAreInOrder(lastEntries, milestones),
    `expected app log milestones in order: ${JSON.stringify(milestones)}`,
  ).toBe(true)
}

export function findAppLogEntry(
  entries: NookLogEntry[],
  filter: {
    scope?: string
    level?: string
    messageIncludes?: string
  },
): NookLogEntry | void {
  return entries.find((entry) => {
    if (filter.scope && entry.scope !== filter.scope) return false
    if (filter.level && entry.level !== filter.level) return false
    if (
      filter.messageIncludes &&
      !entry.message.includes(filter.messageIncludes)
    ) {
      return false
    }
    return true
  })
}

export function appLogEntryMatches(
  entry: NookLogEntry,
  filter: {
    scope?: string
    level?: string
    messageIncludes?: string
  },
): boolean {
  if (filter.scope && entry.scope !== filter.scope) return false
  if (filter.level && entry.level !== filter.level) return false
  if (
    filter.messageIncludes &&
    !entry.message.includes(filter.messageIncludes)
  ) {
    return false
  }
  return true
}

export function appLogMilestonesAreInOrder(
  entries: NookLogEntry[],
  milestones: Array<{
    scope?: string
    level?: string
    messageIncludes: string
  }>,
): boolean {
  let start = 0
  for (const milestone of milestones) {
    const index = entries.findIndex(
      (entry, offset) =>
        offset >= start && appLogEntryMatches(entry, milestone),
    )
    if (index === -1) return false
    start = index + 1
  }
  return true
}

export function expectAppLogEntry(
  entries: NookLogEntry[],
  filter: {
    scope?: string
    level?: string
    messageIncludes?: string
  },
): NookLogEntry {
  const entry = findAppLogEntry(entries, filter)
  expect(
    entry,
    `expected app log matching ${JSON.stringify(filter)}; got scopes: ${[
      ...new Set(entries.map((e) => e.scope)),
    ].join(', ')}`,
  ).toBeDefined()
  return entry!
}

export function parseLogsPageStoredCount(text: string | void): number {
  const match = text?.match(/(\d+) stored/)
  return match ? Number(match[1]) : 0
}

/** Wait until `/logs` shows a stored count matching `predicate` (WASM may init late). */
export async function waitForLogsPageStoredCount(
  page: Page,
  predicate: (count: number) => boolean,
  options?: { timeoutMs?: number },
): Promise<number> {
  let count = 0
  await expect
    .poll(
      async () => {
        await page.getByTestId('logs-refresh-btn').click()
        count = parseLogsPageStoredCount(
          (await page.getByTestId('logs-count').textContent()) ??
            omittedValue(),
        )
        return predicate(count) ? count : omittedValue()
      },
      { timeout: options?.timeoutMs ?? UI_TIMEOUT_MS * 2 },
    )
    .not.toBeUndefined()
  return count
}

export async function expectLogsPageHasEntries(page: Page): Promise<void> {
  await expect(page.getByTestId('logs-page')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await waitForLogsPageStoredCount(page, (stored) => stored > 0)
  await expect(page.getByTestId('logs-entry').first()).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
}

/**
 * Print the app's persisted IndexedDB debug log (`window.__nookLog`) to the
 * test output. The WASM logger persists everything at or above the active
 * level, so lower the level (e.g. `VITE_LOG_LEVEL=debug`) to capture more.
 */
export async function dumpNookLogs(
  page: Page,
  label = 'nook-logs',
  options?: { limit?: number },
) {
  try {
    const entries = await readNookLogEntries(page, options?.limit ?? 200)
    if (!entries) {
      console.warn(`[${label}] __nookLog is not available on the page`)
      return
    }
    printNookLogEntries(label, entries)
  } catch (error) {
    console.warn(
      `[${label}] failed to dump app logs:`,
      error instanceof Error ? error.message : error,
    )
  }
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
  options?: { print?: boolean },
) {
  try {
    const payload = await readNookLogSnapshot(page, {
      minLevel: 'trace',
      limit: APP_LOGS_ATTACHMENT_LIMIT,
      offset: 0,
    })
    if (!payload) return
    if (options?.print && payload.entries.length > 0) {
      printNookLogEntries(
        `nook-logs] [${testInfo.title}`,
        payload.entries.slice(-APP_LOGS_FAILURE_PRINT_LIMIT),
      )
    }
    const body = JSON.stringify(payload, (_key, value) => value, 2)
    const attachmentPath = testInfo.outputPath('nook-app-logs.json')
    await fs.writeFile(attachmentPath, body)
    await testInfo.attach('nook-app-logs.json', {
      path: attachmentPath,
      contentType: 'application/json',
    })
  } catch {
    // Post-mortem logging must never fail the run.
  }
}
