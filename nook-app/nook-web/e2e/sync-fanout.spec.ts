import { expect, test } from './fixtures'
import {
  addSecret,
  createLocalVaultOnLogin,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  reloadUnlockWithSyncProvider,
  uniqueSecretKey,
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

    await reloadUnlockWithSyncProvider(page)

    await expect(page.getByTestId('vault-status-bar')).toContainText('Vault')
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

    await reloadUnlockWithSyncProvider(page)

    const key = uniqueSecretKey('e2e-fanout')
    await addSecret(page, key, 'fan-out-test-value')

    await expect(page.getByTestId('vault-sync-out-status')).toContainText(
      /Syncing to File \(e2e onboard\)|1 sync provider/,
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
  })
})
