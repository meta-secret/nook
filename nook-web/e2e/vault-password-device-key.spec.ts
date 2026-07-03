import { expect, test } from './fixtures'
import {
  addVaultPassword,
  assertNoVaultError,
  assertVaultReady,
  clearBrowserVault,
  createLocalVaultOnLogin,
  expectVaultPasswordStatus,
  expandSettingsSection,
  openStorageSettings,
} from './helpers'

test.describe('vault password on device-key vault', () => {
  test('adds first backup password from settings after login-gate vault creation', async ({
    page,
  }) => {
    await page.goto('/')
    await clearBrowserVault(page)
    await page.reload()

    await expect(page.getByTestId('login-create-vault-chooser')).toBeVisible()
    await createLocalVaultOnLogin(page)
    await assertVaultReady(page)

    await openStorageSettings(page)
    await expandSettingsSection(page, 'unlock')
    await expectVaultPasswordStatus(page, 'none')
    await expect(page.getByTestId('set-vault-password-btn')).toBeVisible()

    await addVaultPassword(page, 'Travel laptop', 'travel-pass-1')

    await assertNoVaultError(page)
    await expect(page.getByTestId('vault-password-card')).toContainText(
      'Travel laptop',
    )
    await expect(page.getByTestId('vault-password-error')).not.toBeVisible()
  })
})
