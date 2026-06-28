import { expect, test } from '@playwright/test'
import {
  addVaultPassword,
  clearBrowserVault,
  connectLocalVault,
  createE2eGithubRepoName,
  disableLoginAutoUnlock,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  expectVaultPasswordStatus,
  expandSettingsSection,
  finishE2eGithubSuite,
  githubPat,
  openStorageSettings,
  resetGithubVault,
  seedExtraGithubProviders,
  UI_TIMEOUT_MS,
  unlockVaultOnLogin,
} from './helpers'

const describeGithub = githubPat ? test.describe : test.describe.skip

describeGithub('unified vault backup passwords', () => {
  test.describe.configure({ mode: 'serial' })

  let emptyRepo: string

  test.beforeAll(async () => {
    emptyRepo = createE2eGithubRepoName()
    await resetGithubVault(githubPat!, emptyRepo)
  })

  test.afterAll(async () => {
    await finishE2eGithubSuite(githubPat!, emptyRepo)
  })

  test('login gate keeps backup passwords after adding sync providers', async ({
    page,
  }) => {
    await page.goto('/')
    await clearBrowserVault(page)
    await page.reload()
    await connectLocalVault(page)

    await openStorageSettings(page)
    await expandSettingsSection(page, 'unlock')
    await addVaultPassword(page, 'Local backup', 'local-pass-1')
    await expectVaultPasswordStatus(page, 1)

    await disableLoginAutoUnlock(page)
    await seedExtraGithubProviders(page, [
      {
        id: 'e2e-empty-github',
        label: 'Empty GitHub',
        githubRepo: emptyRepo,
        githubPat: githubPat!,
      },
    ])
    await page.reload()
    await expect(page.getByTestId('login-gate')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(page.getByTestId('login-local-unlock-step')).toBeVisible()

    await unlockVaultOnLogin(page)
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })

    await openStorageSettings(page)
    await expandSettingsSection(page, 'storage')
    await page.getByTestId('vault-secrets-tab').click()
    await expect
      .poll(async () => page.getByTestId('header-lock-vault-btn').isEnabled(), {
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })
      .toBe(true)
    await page.getByTestId('header-lock-vault-btn').click()
    await expect(page.getByTestId('login-gate')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(page.getByTestId('login-local-unlock-step')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })

    await unlockVaultOnLogin(page)
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })

    await openStorageSettings(page)
    await expandSettingsSection(page, 'unlock')
    await expectVaultPasswordStatus(page, 1)
    await expect(page.getByTestId('vault-password-card')).toContainText(
      'Local backup',
    )
  })
})
