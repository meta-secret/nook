import { expect, test } from './fixtures'
import {
  authorizeDeviceProtection,
  addVaultPassword,
  clearBrowserVault,
  connectLocalVault,
  disableLoginAutoUnlock,
  disableVaultIdleLock,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  expectVaultPasswordStatus,
  expandSettingsSection,
  openStorageSettings,
  readLocalVaultYamlFromIdb,
  reloadUnlockWithSyncProvider,
  stubGoogleDriveVaultForLocalE2e,
  UI_TIMEOUT_MS,
  unlockVaultOnLogin,
} from './helpers'
import { createSyncTarget, installSyncStub } from './sync-provider'

test.describe('unified vault backup passwords (stub sync)', () => {
  test.describe.configure({ mode: 'serial' })

  const target = createSyncTarget('', 'provider-switch')

  test('login gate keeps backup passwords after adding sync providers', async ({
    page,
  }) => {
    await installSyncStub(page, target)
    await page.goto('/')
    await clearBrowserVault(page)
    await page.reload()
    await connectLocalVault(page)

    await openStorageSettings(page)
    await expandSettingsSection(page, 'unlock')
    await addVaultPassword(page, 'Local backup', 'local-pass-1')
    await expectVaultPasswordStatus(page, 1)

    await disableLoginAutoUnlock(page)
    const vaultYaml = await readLocalVaultYamlFromIdb(page)
    await stubGoogleDriveVaultForLocalE2e(
      page,
      { fileName: target.repoName, vaultYaml },
      target.stub,
    )
    await reloadUnlockWithSyncProvider(page, {
      providers: [
        {
          id: 'e2e-empty-sync',
          label: 'File',
          fileName: target.repoName,
          accessToken: target.pat,
        },
      ],
      sharedStub: target.stub,
    })
    await disableVaultIdleLock(page)

    await page.getByTestId('vault-secrets-tab').click()
    await expect
      .poll(async () => page.getByTestId('header-lock-vault-btn').isEnabled(), {
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })
      .toBe(true)
    await page.getByTestId('header-lock-vault-btn').click()
    await authorizeDeviceProtection(page)
    await expect(page.getByTestId('login-local-unlock-step')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })

    await unlockVaultOnLogin(page)
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await disableVaultIdleLock(page)

    await openStorageSettings(page)
    await expandSettingsSection(page, 'unlock')
    await expectVaultPasswordStatus(page, 1)
    await expect(page.getByTestId('vault-password-card')).toContainText(
      'Local backup',
    )
  })
})
