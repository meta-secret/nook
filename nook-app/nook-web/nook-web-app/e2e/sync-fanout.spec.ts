import { expect, test } from './fixtures'
import {
  openIdentitiesPage,
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
    await page.goto('/app/')
    await createLocalVaultOnLogin(page)
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })

    await reloadUnlockWithSyncProvider(page)

    await expect(page.getByTestId('vault-status-bar')).toContainText('Vault')
    await expect(page.getByTestId('vault-sync-out-status')).toContainText(
      '1 sync provider',
    )
    // With a copy kept, the checklist ticks the copy off and asks for a
    // second device.
    await openIdentitiesPage(page)
    const protection = page.getByTestId('identity-protection-toggle')
    await expect(protection).toContainText('1 of 2 done')
    await protection.click()
    const steps = page.getByTestId('identity-protection-step')
    await expect(steps.nth(0)).toHaveAttribute('data-state', 'done')
    await expect(steps.nth(1)).toHaveAttribute('data-state', 'open')
    await expect(page.getByTestId('identity-protection-action')).toContainText(
      'Add a device',
    )
  })

  test('triggers fan-out sync indicator after saving a secret', async ({
    page,
  }) => {
    await page.goto('/app/')
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
