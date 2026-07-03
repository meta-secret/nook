import { expect, test } from './fixtures'
import {
  addVaultPassword,
  clearBrowserVault,
  connectLocalVault,
  disableLoginAutoUnlock,
  expectVaultPasswordStatus,
  expandSettingsSection,
  openStorageSettings,
  readLocalVaultYamlFromIdb,
  reloadUnlockWithSyncProvider,
  stubGoogleDriveVaultForLocalE2e,
  UI_TIMEOUT_MS,
} from './helpers'
import { createSyncTarget, installSyncStub } from './sync-provider'

test.describe('fresh vault password entries (stub sync)', () => {
  test.describe.configure({ mode: 'serial' })

  const target = createSyncTarget('', 'fresh-pw')

  test('local backup passwords persist after adding a local sync provider', async ({
    page,
  }) => {
    await installSyncStub(page, target)
    await page.goto('/')
    await clearBrowserVault(page)
    await page.reload()
    await connectLocalVault(page)

    await openStorageSettings(page)
    await expandSettingsSection(page, 'unlock')
    await addVaultPassword(page, 'Vault A primary', 'vault-a-pass-1', {
      expectedCount: 1,
    })
    await addVaultPassword(page, 'Vault A travel', 'vault-a-pass-2', {
      expectedCount: 2,
    })
    await expectVaultPasswordStatus(page, 2)

    await disableLoginAutoUnlock(page)
    const vaultYaml = await readLocalVaultYamlFromIdb(page)
    await stubGoogleDriveVaultForLocalE2e(page, {
      fileName: target.repoName,
      vaultYaml,
    })
    await reloadUnlockWithSyncProvider(page, {
      providers: [
        {
          id: 'e2e-empty-sync',
          label: 'Empty Drive',
          fileName: target.repoName,
          accessToken: target.pat,
        },
      ],
    })

    await openStorageSettings(page)
    await expandSettingsSection(page, 'unlock')
    await expectVaultPasswordStatus(page, 2)
    await expect(page.getByTestId('vault-password-card')).toContainText(
      'Vault A primary',
    )
    await expect(page.getByTestId('vault-password-card')).toContainText(
      'Vault A travel',
    )
  })
})
