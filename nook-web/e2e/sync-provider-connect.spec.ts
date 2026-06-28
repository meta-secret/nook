import { expect, test } from '@playwright/test'
import {
  createLocalVaultOnLogin,
  DEFAULT_LOCAL_VAULT_PASSWORD,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  seedExtraGithubProviders,
  UI_TIMEOUT_MS,
  waitForLoadedSyncProviders,
} from './helpers'

test.describe('sync provider settings', () => {
  test('shows sync now for a saved github provider', async ({ page }) => {
    await page.goto('/')
    await createLocalVaultOnLogin(page)
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })

    await seedExtraGithubProviders(page, [
      {
        id: 'e2e-sync-github',
        label: 'GitHub (e2e)',
        githubRepo: 'nook-e2e-sync',
        githubPat: 'ghp_test_token',
      },
    ])

    await page.reload()
    await expect(page.getByTestId('login-local-vault-detected')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await page
      .getByTestId('login-master-password-input')
      .fill(DEFAULT_LOCAL_VAULT_PASSWORD)
    await page.getByTestId('unlock-vault-btn').click()
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await waitForLoadedSyncProviders(page)

    await page.getByTestId('vault-settings-tab').click()
    await expect(page.getByTestId('settings-provider-github')).toBeVisible()
    await expect(
      page.getByTestId('sync-provider-e2e-sync-github'),
    ).toBeVisible()
    await expect(page.getByTestId('sync-status-e2e-sync-github')).toContainText(
      'Not synced yet',
    )
  })
})
