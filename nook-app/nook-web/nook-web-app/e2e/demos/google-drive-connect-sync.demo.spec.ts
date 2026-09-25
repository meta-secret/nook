import { I18N_KEYS } from '../../../nook-web-shared/src/generated/i18n-keys'
import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import {
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

test('Google Drive setup shows named New and legacy Existing targets behind the demo-origin gate', async ({
  page,
}) => {
  await page.goto('/app/')
  await clearBrowserVault(page)
  await page.reload()
  await createLocalVaultOnLogin(page)
  await demoBeat(page)

  await openStorageSettings(page)
  await expandSettingsSection(page, 'storage')
  await page.getByTestId('add-provider-btn').first().click()
  await page.getByTestId('provider-option-oauth-file').click()
  await expect(page.getByTestId('google-oauth-setup')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await expect(page.getByTestId('cancel-provider-setup')).toBeVisible()
  await expect(page.getByTestId('google-drive-mode-private')).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await page.getByTestId('drive-file-input').fill('Nook Private Demo Vault')
  await expect(page.getByTestId('drive-file-input')).toHaveValue(
    'Nook Private Demo Vault',
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

  await page.getByTestId('cancel-provider-setup').click()
  const existingLegacyTarget = {
    ...E2E_OAUTH_ONBOARD_PROVIDER,
    id: 'e2e-existing-legacy-drive-demo',
    label: 'Existing Drive demo',
    fileName: 'Nook Legacy Demo Vault',
  }
  const driveStub = createLocalE2eGoogleDriveVaultStub(
    '',
    existingLegacyTarget.fileName,
  )
  await driveStub.install(page, {
    accessToken: existingLegacyTarget.accessToken,
    fileName: existingLegacyTarget.fileName,
  })
  await seedExtraOauthFileProviders(page, [existingLegacyTarget])
  const providersLoaded = await page.evaluate(async () => {
    const vault = window.__nookVault
    if (!vault) return false
    return (await vault.loadProviders({ ensureLocalRow: false })).isOk()
  })
  expect(providersLoaded).toBe(true)
  const existingDriveProvider = page.getByTestId('settings-provider-oauth-file')
  await expect(existingDriveProvider).toBeVisible({ timeout: UI_TIMEOUT_MS })
  await expect(existingDriveProvider).toContainText(
    existingLegacyTarget.fileName,
  )
  await demoBeat(page)
})
