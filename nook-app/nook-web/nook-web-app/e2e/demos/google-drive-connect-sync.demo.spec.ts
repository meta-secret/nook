import { I18N_KEYS } from '../../../nook-web-shared/src/generated/i18n-keys'
import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import {
  ManagePage,
  openManagePage,
  beginAddSyncProvider,
  clearBrowserVault,
  createLocalE2eGoogleDriveVaultStub,
  createLocalVaultOnLogin,
  expandSettingsSection,
  openStorageSettings,
  E2E_OAUTH_ONBOARD_PROVIDER,
  seedExtraOauthFileProviders,
  UI_TIMEOUT_MS,
} from '../helpers'

const DEMO_BEAT_MS = 700

type DemoVaultWindow = Window & {
  __nookVault?: {
    errorMsg: string
    t: (key: string) => string
  }
}

async function demoBeat(page: Page) {
  await page.waitForTimeout(DEMO_BEAT_MS)
}

test('Google Drive setup names its vault folder behind the demo-origin gate and lists an existing folder provider', async ({
  page,
}) => {
  await page.goto('/app/')
  await clearBrowserVault(page)
  await page.reload()
  await createLocalVaultOnLogin(page)
  await demoBeat(page)

  await openStorageSettings(page)
  await expandSettingsSection(page, 'storage')
  await beginAddSyncProvider(page)
  await page.getByTestId('provider-option-oauth-file').click()
  await expect(page.getByTestId('google-oauth-setup')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await expect(page.getByTestId('cancel-provider-setup')).toBeVisible()
  // Every Drive provider syncs under one My Drive vault folder; the folder
  // step waits for sign-in.
  await expect(page.getByTestId('google-shared-folder-step')).toBeVisible()
  await page.getByTestId('drive-file-input').fill('Nook Demo Vault')
  await expect(page.getByTestId('drive-file-input')).toHaveValue(
    'Nook Demo Vault',
  )
  // UI demos run on 127.0.0.1:5183, which is outside Google's authorized origins.
  await expect(page.getByTestId('google-origin-unsupported')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await expect(page.getByTestId('google-sign-in-btn')).toBeDisabled()
  await demoBeat(page)

  await page.evaluate((timeoutKey) => {
    const vault = (window as DemoVaultWindow).__nookVault
    if (!vault) {
      throw new Error('__nookVault is unavailable')
    }
    vault.errorMsg = vault.t(timeoutKey)
  }, I18N_KEYS.ToastsErrorTimeout)
  const vaultError = page.getByTestId('vault-error')
  await expect(vaultError).toBeVisible({ timeout: UI_TIMEOUT_MS })
  await expect(vaultError).toContainText(/provider sign-in/i)
  await expect(vaultError).not.toContainText(/PAT/i)
  await demoBeat(page)

  // Adding a provider is its own page: Back leaves it unsaved.
  await page.getByTestId('identity-page-back').click()
  await openManagePage(page, ManagePage.Sync)
  const existingFolderTarget = {
    ...E2E_OAUTH_ONBOARD_PROVIDER,
    id: 'e2e-existing-drive-folder-demo',
    label: 'Existing Drive demo',
    fileName: 'Nook Existing Demo Vault',
  }
  const driveStub = createLocalE2eGoogleDriveVaultStub(
    '',
    existingFolderTarget.fileName,
  )
  await driveStub.install(page, {
    accessToken: existingFolderTarget.accessToken,
    fileName: existingFolderTarget.fileName,
  })
  await seedExtraOauthFileProviders(page, [existingFolderTarget])
  const providersLoaded = await page.evaluate(async () => {
    const vault = window.__nookVault
    if (!vault) return false
    return (await vault.loadProviders({ ensureLocalRow: false })).isOk()
  })
  expect(providersLoaded).toBe(true)
  const existingDriveProvider = page.getByTestId('settings-provider-oauth-file')
  await expect(existingDriveProvider).toBeVisible({ timeout: UI_TIMEOUT_MS })
  await expect(existingDriveProvider).toContainText(
    existingFolderTarget.fileName,
  )
  await demoBeat(page)
})
