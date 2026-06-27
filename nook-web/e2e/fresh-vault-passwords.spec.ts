import { expect, test } from '@playwright/test'
import {
  addVaultPassword,
  clearBrowserVault,
  connectLocalVault,
  createE2eGithubRepoName,
  expandSettingsSection,
  finishE2eGithubSuite,
  githubPat,
  openStorageSettings,
  resetGithubVault,
  UI_TIMEOUT_MS,
  waitForGithubVaultState,
} from './helpers'

const describeGithub = githubPat ? test.describe : test.describe.skip

describeGithub('fresh vault password entries', () => {
  test.describe.configure({ mode: 'serial' })

  let emptyRepo: string

  test.beforeAll(async () => {
    emptyRepo = createE2eGithubRepoName()
    await resetGithubVault(githubPat!, emptyRepo)
  })

  test.afterAll(async () => {
    await finishE2eGithubSuite(githubPat!, emptyRepo)
  })

  test('settings shows no backup passwords after connecting a new empty github vault', async ({
    page,
  }) => {
    await page.goto('/')
    await clearBrowserVault(page)
    await page.reload()
    await connectLocalVault(page)

    await openStorageSettings(page)
    await expandSettingsSection(page, 'unlock')
    await addVaultPassword(page, 'Vault A primary', 'vault-a-pass-1')
    await addVaultPassword(page, 'Vault A travel', 'vault-a-pass-2')
    await expect(page.getByTestId('vault-password-status')).toContainText(
      '2 passwords',
      { timeout: UI_TIMEOUT_MS },
    )

    await expandSettingsSection(page, 'storage')
    await page.getByTestId('add-provider-btn').click()
    await page.getByTestId('provider-option-github').click()
    await page.getByTestId('github-repo-input').fill(emptyRepo)
    await page.getByTestId('github-pat-input').fill(githubPat!)
    await page.getByTestId('connect-provider-btn').click()

    await waitForGithubVaultState(
      { pat: githubPat!, repoName: emptyRepo },
      (yaml) => yaml.authPkIds.length >= 1,
      { page },
    )
    await expect(page.getByTestId('app-success')).toContainText('GitHub', {
      timeout: UI_TIMEOUT_MS,
    })

    await expandSettingsSection(page, 'unlock')
    await expect(page.getByTestId('vault-password-status')).toContainText(
      'None',
      { timeout: UI_TIMEOUT_MS },
    )
    await expect(page.getByTestId('vault-password-card')).not.toContainText(
      'Vault A primary',
    )
    await expect(page.getByTestId('vault-password-card')).not.toContainText(
      'Vault A travel',
    )
  })
})
