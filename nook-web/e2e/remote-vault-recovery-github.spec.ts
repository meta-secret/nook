import { expect, test, type Page } from '@playwright/test'
import {
  addSecret,
  assertRemoteVaultRecoveryPanel,
  assertVaultReady,
  clearBrowserVault,
  clickLoginConnectProvider,
  connectGithubVault,
  createE2eGithubRepoName,
  createFreshRemoteVaultOnLogin,
  deleteAllVaultLocalCaches,
  disableLoginAutoUnlock,
  finishE2eGithubSuite,
  githubPat,
  recoverRemoteVaultOnLogin,
  resetGithubVault,
  revealSecretInRow,
  UI_TIMEOUT_MS,
  uniqueSecretKey,
  waitForGithubVaultState,
} from './helpers'

const describeGithub = githubPat ? test.describe : test.describe.skip

describeGithub('remote vault recovery (github)', () => {
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

  test('prompts to recover from browser cache when the remote vault file was deleted', async () => {
    const key = uniqueSecretKey('e2e-recover')
    const value = 'recovered-from-browser-cache'

    await addSecret(vaultPage, key, value, target())
    await resetGithubVault(githubPat, e2eRepo)

    await vaultPage.reload()
    await expect(vaultPage.getByTestId('login-gate')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })

    await clickLoginConnectProvider(vaultPage, 'github')
    await assertRemoteVaultRecoveryPanel(vaultPage, { withLocalCache: true })

    await recoverRemoteVaultOnLogin(vaultPage)
    await vaultPage.getByTestId('unlock-vault-btn').click()
    await assertVaultReady(vaultPage)

    const row = vaultPage.getByTestId('secret-row').filter({ hasText: key })
    await row.waitFor()
    await revealSecretInRow(row)
    await row.getByText(value).waitFor()

    await waitForGithubVaultState(
      target(),
      (yaml) => yaml.secretIds.length >= 1,
      { page: vaultPage },
    )
  })

  test('offers create-fresh when remote file is missing and no local cache exists', async () => {
    await resetGithubVault(githubPat, e2eRepo)
    await deleteAllVaultLocalCaches(vaultPage)

    await vaultPage.reload()
    await expect(vaultPage.getByTestId('login-gate')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })

    await clickLoginConnectProvider(vaultPage, 'github')
    await assertRemoteVaultRecoveryPanel(vaultPage, { withLocalCache: false })

    await createFreshRemoteVaultOnLogin(vaultPage)
    await vaultPage.getByTestId('unlock-vault-btn').click()
    await assertVaultReady(vaultPage)

    await waitForGithubVaultState(
      target(),
      (yaml) => yaml.authPkIds.length >= 1 && yaml.memberPkIds.length >= 1,
      { page: vaultPage },
    )
  })
})
