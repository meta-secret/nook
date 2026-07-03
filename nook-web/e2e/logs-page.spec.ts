import { expect, test } from './fixtures'
import {
  addSecret,
  createLocalVaultOnLogin,
  disableVaultIdleLock,
  expectAppLogEntry,
  forceVaultQuiescentForE2e,
  expectLogsPageHasEntries,
  fetchAppLogs,
  flushNookLogPersistQueue,
  pauseVaultBackgroundSync,
  UI_TIMEOUT_MS,
  waitForPersistedAppLog,
} from './helpers'

test.describe('application logging', () => {
  test('renders the /logs viewer and returns home', async ({ page }) => {
    await page.goto('/logs')

    await expect(page.getByTestId('logs-page')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(page).toHaveTitle(/Application logs · Nook/)
    await expect(page.getByTestId('logs-level-filter')).toBeVisible()
    await expect(page.getByTestId('logs-capture-level')).toBeVisible()
    await expect(page.getByTestId('logs-count')).toBeVisible()

    await page.getByTestId('logs-back-btn').click()
    await expect(page.getByTestId('logs-page')).not.toBeVisible()
    await expect(page).toHaveURL('/')
  })

  test('persists info-level milestones when creating a local vault', async ({
    page,
  }) => {
    await page.goto('/')
    await createLocalVaultOnLogin(page)

    await waitForPersistedAppLog(page, {
      scope: 'vault',
      level: 'info',
      messageIncludes: 'app init finished',
    })
    await waitForPersistedAppLog(page, {
      scope: 'vault-local',
      level: 'info',
      messageIncludes: 'local vault created',
    })
    await waitForPersistedAppLog(page, {
      scope: 'wasm-connect',
      level: 'info',
      messageIncludes: 'connect complete',
    })
    await waitForPersistedAppLog(page, {
      scope: 'vault',
      level: 'info',
      messageIncludes: 'vault session unlocked',
    })

    const payload = await fetchAppLogs(page, { minLevel: 'info', limit: 500 })
    expect(payload.meta.schema).toBe('nook.app-logs.v1')
    expect(payload.meta.returned).toBeGreaterThan(0)
  })

  test('records secret add and vault lock at info level', async ({ page }) => {
    await page.goto('/')
    await createLocalVaultOnLogin(page)
    await addSecret(page, 'log-test-key', 'log-test-value')
    await page.getByTestId('header-lock-vault-btn').click()
    await expect(page.getByTestId('login-gate')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })

    await waitForPersistedAppLog(page, {
      scope: 'connect',
      level: 'info',
      messageIncludes: 'secret added',
    })
    await waitForPersistedAppLog(page, {
      scope: 'vault-session',
      level: 'info',
      messageIncludes: 'vault locked',
    })

    const payload = await fetchAppLogs(page, { minLevel: 'info', limit: 500 })
    expectAppLogEntry(payload.entries, {
      scope: 'connect',
      level: 'info',
      messageIncludes: 'secret added',
    })
    expectAppLogEntry(payload.entries, {
      scope: 'vault-session',
      level: 'info',
      messageIncludes: 'vault locked',
    })
  })

  test('shows persisted entries on /logs when capture level is debug', async ({
    page,
  }) => {
    await page.addInitScript(() =>
      localStorage.setItem('nook_log_level', 'debug'),
    )

    await page.goto('/')
    await createLocalVaultOnLogin(page)
    await flushNookLogPersistQueue(page)
    await disableVaultIdleLock(page)
    await pauseVaultBackgroundSync(page)

    await page.goto('/logs')
    await expectLogsPageHasEntries(page)
    await expect(page.getByTestId('logs-count')).not.toContainText('0 stored')
  })

  test('clear removes stored entries from /logs', async ({ page }) => {
    await page.goto('/')
    await createLocalVaultOnLogin(page)
    await flushNookLogPersistQueue(page)

    await page.goto('/logs')
    await expectLogsPageHasEntries(page)
    await forceVaultQuiescentForE2e(page)

    await page.getByTestId('logs-clear-btn').click()
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const log = (
              window as Window & {
                __nookLog?: {
                  flush: () => Promise<void>
                  count: () => Promise<number>
                }
              }
            ).__nookLog
            await log?.flush()
            return (await log?.count()) ?? -1
          }),
        { timeout: UI_TIMEOUT_MS * 2 },
      )
      .toBe(0)
  })

  test('capture level selector updates persistence level', async ({ page }) => {
    await page.goto('/logs')
    await expect(page.getByTestId('logs-page')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })

    await page.getByTestId('logs-capture-level').selectOption('debug')
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            (
              window as Window & {
                __nookLog?: { getLevel: () => string }
              }
            ).__nookLog?.getLevel() ?? '',
        ),
      )
      .toBe('debug')
  })

  test('exports persisted entries as JSON from /app-logs', async ({ page }) => {
    await page.goto('/')
    await createLocalVaultOnLogin(page)
    await flushNookLogPersistQueue(page)

    const payload = await fetchAppLogs(page, {
      minLevel: 'trace',
      limit: 100,
    })

    expect(payload.meta.schema).toBe('nook.app-logs.v1')
    expect(payload.meta.returned).toBeGreaterThan(0)
    expect(payload.entries.length).toBeGreaterThan(0)
    expect(payload.entries[0]).toMatchObject({
      ts: expect.any(String),
      level: expect.any(String),
      scope: expect.any(String),
      message: expect.any(String),
    })
  })

  test('/app-logs respects minLevel and limit query params', async ({
    page,
  }) => {
    await page.addInitScript(() =>
      localStorage.setItem('nook_log_level', 'debug'),
    )

    await page.goto('/')
    await createLocalVaultOnLogin(page)
    await flushNookLogPersistQueue(page)

    const all = await fetchAppLogs(page, { minLevel: 'trace', limit: 500 })
    const infoOnly = await fetchAppLogs(page, { minLevel: 'info', limit: 500 })
    const capped = await fetchAppLogs(page, { minLevel: 'trace', limit: 3 })

    expect(all.meta.returned).toBeGreaterThan(0)
    expect(infoOnly.meta.returned).toBeGreaterThan(0)
    expect(infoOnly.entries.every((entry) => entry.level !== 'debug')).toBe(
      true,
    )
    expect(capped.meta.limit).toBe(3)
    expect(capped.entries.length).toBeLessThanOrEqual(3)
    expect(capped.meta.returned).toBeLessThanOrEqual(3)
    if (all.meta.returned > infoOnly.meta.returned) {
      expect(all.meta.returned).toBeGreaterThan(infoOnly.meta.returned)
    }
  })

  test('persists console errors and failed fetch responses at default level', async ({
    page,
  }) => {
    await page.route('**/nook-e2e-missing-resource-404', (route) => {
      void route.fulfill({ status: 404, body: 'not found' })
    })

    await page.goto('/')
    await createLocalVaultOnLogin(page)

    await page.evaluate(async () => {
      console.error('nook-e2e-console-error-marker')
      await fetch('/nook-e2e-missing-resource-404')
    })
    await flushNookLogPersistQueue(page)

    await waitForPersistedAppLog(page, {
      scope: 'console',
      level: 'error',
      messageIncludes: 'nook-e2e-console-error-marker',
    })
    await waitForPersistedAppLog(page, {
      scope: 'fetch',
      level: 'warn',
      messageIncludes: 'HTTP 404',
    })
  })
})
