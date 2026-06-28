import { expect, test } from '@playwright/test'
import {
  addSecret,
  createLocalVaultOnLogin,
  DEFAULT_LOCAL_VAULT_PASSWORD,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  seedExtraGithubProviders,
  UI_TIMEOUT_MS,
  uniqueSecretKey,
  waitForLoadedSyncProviders,
} from './helpers'

test.describe('sync fan-out on save', () => {
  test('shows local vault label and sync provider count in status bar', async ({
    page,
  }) => {
    await page.goto('/')
    await createLocalVaultOnLogin(page)
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })

    await expect(page.getByTestId('vault-status-bar')).toContainText(
      'Local vault',
    )
    await expect(page.getByTestId('vault-sync-out-status')).toContainText(
      'No sync providers',
    )

    await seedExtraGithubProviders(page, [
      {
        id: 'e2e-fanout-github',
        label: 'GitHub (fan-out)',
        githubRepo: 'nook-e2e-fanout',
        githubPat: 'ghp_test_token',
      },
    ])

    await page.reload()
    await page
      .getByTestId('login-master-password-input')
      .fill(DEFAULT_LOCAL_VAULT_PASSWORD)
    await page.getByTestId('unlock-vault-btn').click()
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await waitForLoadedSyncProviders(page)

    await expect(page.getByTestId('vault-sync-out-status')).toContainText(
      '1 sync provider',
    )
  })

  test('triggers fan-out sync indicator after saving a secret', async ({
    page,
  }) => {
    await page.goto('/')
    await createLocalVaultOnLogin(page)
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })

    await seedExtraGithubProviders(page, [
      {
        id: 'e2e-fanout-github',
        label: 'GitHub (fan-out)',
        githubRepo: 'nook-e2e-fanout',
        githubPat: 'ghp_test_token',
      },
    ])

    await page.reload()
    await page
      .getByTestId('login-master-password-input')
      .fill(DEFAULT_LOCAL_VAULT_PASSWORD)
    await page.getByTestId('unlock-vault-btn').click()
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await waitForLoadedSyncProviders(page)

    const key = uniqueSecretKey('e2e-fanout')
    await addSecret(page, key, 'fan-out-test-value')

    await expect(page.getByTestId('vault-sync-out-status')).toContainText(
      /Syncing to GitHub \(fan-out\)|1 sync provider/,
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
  })
})
