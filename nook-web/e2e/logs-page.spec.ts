import { expect, test } from './fixtures'
import { createLocalVaultOnLogin, UI_TIMEOUT_MS } from './helpers'

type NookLogWindow = Window & {
  __nookLog?: { dump: () => Promise<unknown> }
}

test.describe('application logs page', () => {
  test('renders the /logs viewer and returns home', async ({ page }) => {
    await page.goto('/logs')

    await expect(page.getByTestId('logs-page')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(page).toHaveTitle(/Application logs · Nook/)
    await expect(page.getByTestId('logs-level-filter')).toBeVisible()
    await expect(page.getByTestId('logs-count')).toBeVisible()

    await page.getByTestId('logs-back-btn').click()
    await expect(page.getByTestId('logs-page')).not.toBeVisible()
    await expect(page).toHaveURL('/')
  })

  test('captures persisted entries when the level is lowered', async ({
    page,
  }) => {
    // The default level is `info`; app logs are `debug`, so capture at debug.
    await page.addInitScript(() =>
      localStorage.setItem('nook_log_level', 'debug'),
    )

    await page.goto('/')
    await createLocalVaultOnLogin(page)

    // Flush the in-memory queue to IndexedDB before navigating away.
    await page.evaluate(
      () => (window as NookLogWindow).__nookLog?.dump() ?? null,
    )

    await page.goto('/logs')
    await expect(page.getByTestId('logs-page')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })

    await page.getByTestId('logs-level-filter').selectOption('trace')
    await page.getByTestId('logs-refresh-btn').click()

    await expect(page.getByTestId('logs-entry').first()).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(page.getByTestId('logs-count')).not.toContainText('0 stored')
  })
})
