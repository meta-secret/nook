import { expect, test, type Page } from '@playwright/test'
import {
  addSecret,
  assertVaultReady,
  clearBrowserVault,
  connectGithubVault,
  createE2eGithubRepoName,
  disableLoginAutoUnlock,
  finishE2eGithubSuite,
  githubPat,
  resetGithubVault,
  revealSecretInRow,
  UI_TIMEOUT_MS,
  uniqueSecretKey,
  unlockVaultOnLogin,
  waitForGithubVaultState,
} from './helpers'

const describeGithub = githubPat ? test.describe : test.describe.skip

describeGithub('remote vault recovery (github, local-first)', () => {
  test.describe.configure({ mode: 'serial' })

  let vaultPage: Page
  let e2eRepo: string
  const target = () => ({ pat: githubPat, repoName: e2eRepo })

  test.beforeAll(async ({ browser }) => {
    e2eRepo = createE2eGithubRepoName()
    await resetGithubVault(githubPat, e2eRepo)
    vaultPage = await browser.newPage()
    await vaultPage.goto('/')
    await clearBrowserVault(vaultPage)
    await vaultPage.reload()
    await connectGithubVault(vaultPage, githubPat, e2eRepo)
    await disableLoginAutoUnlock(vaultPage)
  })

  test.afterAll(async () => {
    await vaultPage?.close()
    await finishE2eGithubSuite(githubPat, e2eRepo)
  })

  test('unlocks from local vault and re-syncs after remote file was deleted', async () => {
    const key = uniqueSecretKey('e2e-recover')
    const value = 'recovered-from-local-vault'

    await addSecret(vaultPage, key, value, target())
    await resetGithubVault(githubPat, e2eRepo)

    await vaultPage.reload()
    await expect(vaultPage.getByTestId('login-gate')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })

    await unlockVaultOnLogin(vaultPage)
    await assertVaultReady(vaultPage)

    const row = vaultPage.getByTestId('secret-row').filter({ hasText: key })
    await row.waitFor()
    await revealSecretInRow(row)
    await row.getByText(value).waitFor()

    await vaultPage.getByTestId('vault-sync-refresh-btn').click()
    await waitForGithubVaultState(
      target(),
      (yaml) => yaml.secretIds.length >= 1,
      { page: vaultPage },
    )
  })
})
