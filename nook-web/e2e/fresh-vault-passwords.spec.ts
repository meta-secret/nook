import { expect, test } from '@playwright/test'
import {
  addVaultPassword,
  clearBrowserVault,
  connectLocalVault,
  disableLoginAutoUnlock,
  expectVaultPasswordStatus,
  expandSettingsSection,
  openStorageSettings,
  seedExtraGithubProviders,
  UI_TIMEOUT_MS,
  unlockVaultOnLogin,
  waitForLoadedSyncProviders,
} from './helpers'
import {
  createE2eStubRepoName,
  createStubSyncTarget,
  installStubOnPage,
} from './sync-stub'

test.describe('fresh vault password entries (stub sync)', () => {
  test.describe.configure({ mode: 'serial' })

  const target = createStubSyncTarget('', 'fresh-pw')

  test('local backup passwords persist after adding a github sync provider', async ({
    page,
  }) => {
    await installStubOnPage(page, target)
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
    await seedExtraGithubProviders(page, [
      {
        id: 'e2e-empty-github',
        label: 'Empty GitHub',
        githubRepo: target.repoName,
        githubPat: target.pat,
      },
    ])
    await page.reload()
    await expect(page.getByTestId('login-gate')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await unlockVaultOnLogin(page)
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await waitForLoadedSyncProviders(page, 2)

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
