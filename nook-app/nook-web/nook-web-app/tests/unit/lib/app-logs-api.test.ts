import { beforeEach, describe, expect, test, vi } from 'vitest'

const waitForWasmLogging = vi.hoisted(() => vi.fn())
const logCount = vi.hoisted(() => vi.fn())
const dumpLogs = vi.hoisted(() => vi.fn())
const getLogLevel = vi.hoisted(() => vi.fn())

vi.mock('$lib/runtime/log', () => ({
  LogLevel: {
    Error: 'error',
    Warn: 'warn',
    Info: 'info',
    Debug: 'debug',
    Trace: 'trace',
  },
  browserLogRuntime: {
    waitForWasmLogging,
    logCount,
    dumpLogs,
    getLogLevel,
  },
}))

import { APP_LOGS_SCHEMA, AppLogsExport } from '$lib/app/logs-api'
import { LogLevel } from '$lib/runtime/log'

describe('AppLogsExport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    logCount.mockResolvedValue(2)
    dumpLogs.mockResolvedValue([
      {
        ts: '2026-09-11T00:00:00.000Z',
        level: LogLevel.Info,
        scope: 'vault-lifecycle',
        message: 'app init finished',
      },
    ])
    getLogLevel.mockReturnValue(LogLevel.Info)
  })

  test('waits for WASM logging before reading the persisted export', async () => {
    let markReady = () => {}
    waitForWasmLogging.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          markReady = resolve
        }),
    )

    const exportCompletion = new AppLogsExport({
      minLevel: LogLevel.Info,
      limit: 500,
      offset: 0,
    }).execute()
    await Promise.resolve()

    expect(logCount).not.toHaveBeenCalled()
    expect(dumpLogs).not.toHaveBeenCalled()

    markReady()
    const response = await exportCompletion

    expect(response.meta).toMatchObject({
      schema: APP_LOGS_SCHEMA,
      minLevel: LogLevel.Info,
      limit: 500,
      offset: 0,
      returned: 1,
      total: 2,
    })
    expect(response.entries).toHaveLength(1)
  })
})
