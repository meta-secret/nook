import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import { createLocalE2eGoogleDriveVaultStub } from '../drive-stub'
import {
  assertNoVaultErrors,
  assertVaultReady,
  clearBrowserVault,
  connectGoogleDriveVault,
  expandSettingsSection,
  openStorageSettings,
  UI_TIMEOUT_MS,
  waitForVaultOperationsIdle,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
} from '../helpers'

const DEMO_BEAT_MS = 700

async function demoBeat(page: Page) {
  await page.waitForTimeout(DEMO_BEAT_MS)
}

test('connect Google Drive and re-sync without a PAT timeout toast', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const accessToken = 'ya29.e2e_drive_connect_timeout'
  const fileName = 'drive-connect-timeout-demo'
  const stub = createLocalE2eGoogleDriveVaultStub('', fileName)

  await page.goto('/app/')
  await clearBrowserVault(page)
  await page.reload()
  await connectGoogleDriveVault(page, accessToken, fileName, stub)
  await assertVaultReady(page)
  await demoBeat(page)

  await openStorageSettings(page)
  await expandSettingsSection(page, 'storage')
  const syncBtn = page.locator('[data-testid^="sync-provider-"]').first()
  await expect(syncBtn).toBeVisible({ timeout: UI_TIMEOUT_MS })
  await syncBtn.click()
  await waitForVaultOperationsIdle(page, ENROLLMENT_UNLOCK_TIMEOUT_MS)
  await assertNoVaultErrors(page)

  const vaultError = page.getByTestId('vault-error')
  if (await vaultError.isVisible()) {
    await expect(vaultError).not.toContainText(/PAT/i)
  }
  await expect(page.getByTestId('authenticated-shell')).toBeVisible()
  await demoBeat(page)
})
