import { expect, test } from './fixtures'
import {
  createLocalVaultOnLogin,
  reloadUnlockWithSyncProvider,
  UI_TIMEOUT_MS,
} from './helpers'

test.describe('sync provider settings', () => {
  test('shows sync now for a saved local sync provider', async ({ page }) => {
    await page.goto('/')
    await createLocalVaultOnLogin(page)
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })

    await reloadUnlockWithSyncProvider(page)

    await page.getByTestId('vault-admin-tab').click()
    await expect(page.getByTestId('vault-admin-panel')).toBeVisible()
    await page
      .getByTestId('storage-providers-section')
      .getByRole('button')
      .first()
      .click()
    await expect(page.getByTestId('settings-provider-oauth-file')).toBeVisible()
    await expect(
      page.getByTestId('sync-provider-e2e-onboard-oauth'),
    ).toBeVisible()
    await expect(
      page.getByTestId('sync-status-e2e-onboard-oauth'),
    ).toContainText(/Not synced yet|Last synced/i)
  })
})
