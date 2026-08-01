import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import {
  clearBrowserVault,
  createLocalVaultOnLogin,
  UI_TIMEOUT_MS,
} from '../helpers'

const DEMO_BEAT_MS = 700
type DemoVaultWindow = Window & {
  __nookVault?: {
    loginDeviceKeysCapable: boolean
    loginPasswordPrompt: boolean
    passwordEntries: Array<{ id: string; label: string; createdAt: string }>
    clearProjectionConflicts(): void
    stageSecurityConflictForTesting(events: string[], reasons: string[]): void
    stageStoreIdSyncConflictForTesting(
      providerLabel: string,
      localStoreId: string,
      remoteStoreId: string,
    ): void
  }
}

async function demoBeat(page: Page) {
  await page.waitForTimeout(DEMO_BEAT_MS)
}

test('import-as-new-vault conflict and unlock honesty surface', async ({
  page,
}) => {
  await page.goto('/app/')
  await clearBrowserVault(page)
  await page.reload()
  await createLocalVaultOnLogin(page, 'demo-local')
  await demoBeat(page)

  await page.evaluate(() => {
    const vault = (window as DemoVaultWindow).__nookVault
    if (!vault) {
      throw new Error('__nookVault is unavailable')
    }
    vault.stageSecurityConflictForTesting(
      ['sha256u:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo'],
      ['key epoch rotation'],
    )
  })
  await expect(
    page.getByText('Security conflict detected', { exact: true }),
  ).toBeVisible({ timeout: UI_TIMEOUT_MS })
  await expect(page.getByTestId('add-secret-btn')).toBeDisabled()
  await demoBeat(page)

  await page.evaluate(() => {
    const vault = (window as DemoVaultWindow).__nookVault
    if (!vault) {
      throw new Error('__nookVault is unavailable')
    }
    vault.clearProjectionConflicts()
  })
  await expect(
    page.getByText('Security conflict detected', { exact: true }),
  ).not.toBeVisible()

  await page.evaluate(() => {
    const vault = (window as DemoVaultWindow).__nookVault
    if (!vault) {
      throw new Error('__nookVault is unavailable')
    }
    vault.stageStoreIdSyncConflictForTesting(
      'Google Drive',
      'store_localDemo01',
      'store_remoteDemo1',
    )
  })

  await expect(page.getByTestId('vault-sync-conflict-dialog')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await expect(
    page.getByTestId('sync-conflict-import-new-vault-btn'),
  ).toBeVisible()
  await demoBeat(page)

  await page.getByTestId('sync-conflict-cancel-btn').click()
  await expect(page.getByTestId('vault-sync-conflict-dialog')).not.toBeVisible()
  await page.getByTestId('header-lock-vault-btn').click()
  await expect(page.getByTestId('login-local-unlock-step')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await demoBeat(page)

  await page.evaluate(() => {
    const vault = (window as DemoVaultWindow).__nookVault
    if (!vault) {
      throw new Error('__nookVault is unavailable')
    }
    vault.loginDeviceKeysCapable = false
    vault.loginPasswordPrompt = true
    vault.passwordEntries = [
      {
        id: 'demo-password-entry',
        label: 'Recovery',
        createdAt: '2026-08-01T00:00:00Z',
      },
    ]
  })

  await expect(page.getByTestId('login-device-keys-unavailable')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await expect(page.getByTestId('login-unlock-method-keys')).toBeDisabled()
  await expect(page.getByTestId('login-unlock-method-password')).toBeVisible()
  await expect(page.getByTestId('login-password-input')).toBeVisible()
  await demoBeat(page)
})
