import { expect, test } from '../fixtures'
import {
  clearBrowserVault,
  connectLocalVault,
  flushNookLogPersistQueue,
  readPersistedAppLogs,
  UI_TIMEOUT_MS,
} from '../helpers'

const DEMO_BEAT_MS = 700

type DemoVaultWindow = Window & {
  __nookVault?: {
    storageMode: string
  }
}

test('open a new local vault without an empty-device sync error', async ({
  page,
}) => {
  await page.goto('/app/')
  await clearBrowserVault(page)
  await page.reload()
  await expect(page.getByTestId('login-create-vault-chooser')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await page.waitForTimeout(DEMO_BEAT_MS)

  await connectLocalVault(page)
  await expect(page.getByTestId('vault-panel')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await expect(page.getByTestId('header-lock-vault-btn')).toBeEnabled()
  await expect(page.getByTestId('join-enrollment-dialog')).toHaveCount(0)
  await expect(page.getByTestId('login-password-entry-list')).toHaveCount(0)
  await expect
    .poll(() =>
      page.evaluate(() => {
        const vault = (window as DemoVaultWindow).__nookVault
        return vault?.storageMode
      }),
    )
    .toBe('local')
  await page.waitForTimeout(DEMO_BEAT_MS)

  const languageSelect = page.getByTestId('header-language-select')
  await languageSelect.click()
  await page.getByTestId('header-language-option-ru').click()
  await expect(languageSelect).toHaveText('RU')
  await page.waitForTimeout(DEMO_BEAT_MS)

  // Keep the typed workspace-to-secret-form callback boundary in the demo.
  await page.getByTestId('add-secret-btn').click()
  await expect(page.getByTestId('item-type-picker')).toBeVisible()
  await page.getByTestId('add-secret-back-btn').click()
  await expect(page.getByTestId('add-secret-panel')).toBeHidden()

  await flushNookLogPersistQueue(page)
  const logs = await readPersistedAppLogs(page)
  expect(
    logs.some(
      (entry) =>
        entry.scope === 'wasm-connect' && entry.message === 'connect complete',
    ),
  ).toBe(true)
  expect(
    logs.some(
      (entry) =>
        entry.scope === 'vault-sync' &&
        entry.message === 'vault sync timer started',
    ),
  ).toBe(true)
  expect(
    logs.some(
      (entry) =>
        entry.scope === 'vault-sync' &&
        entry.data?.includes('Vault crypto not initialized'),
    ),
  ).toBeFalsy()
})
