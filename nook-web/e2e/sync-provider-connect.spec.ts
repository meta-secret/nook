import { expect, test } from '@playwright/test'
import {
  createLocalVaultOnLogin,
  reloadUnlockWithGithubSync,
  UI_TIMEOUT_MS,
} from './helpers'

test.describe('sync provider settings', () => {
  test('shows sync now for a saved github provider', async ({ page }) => {
    await page.goto('/')
    await createLocalVaultOnLogin(page)
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })

    await reloadUnlockWithGithubSync(page)

    await page.getByTestId('vault-settings-tab').click()
    await expect(page.getByTestId('settings-provider-github')).toBeVisible()
    await expect(
      page.getByTestId('sync-provider-e2e-onboard-github'),
    ).toBeVisible()
    await expect(
      page.getByTestId('sync-status-e2e-onboard-github'),
    ).toContainText(/Not synced yet|Last synced/i)
  })
})
