import { expect, test } from '../fixtures'
import {
  clearBrowserVault,
  connectLocalVault,
  flushNookLogPersistQueue,
  readPersistedAppLogs,
  UI_TIMEOUT_MS,
} from '../helpers'

const DEMO_BEAT_MS = 700

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
  await page.waitForTimeout(DEMO_BEAT_MS)

  await flushNookLogPersistQueue(page)
  const logs = await readPersistedAppLogs(page)
  if (!logs) throw new Error('expected persisted app logs after vault setup')
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
        entry.data?.includes('Vault crypto not initialized'),
    ),
  ).toBeFalsy()
})
