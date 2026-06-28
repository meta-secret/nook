import { test, expect, type Page } from '@playwright/test'
import {
  addSecret,
  clearBrowserVault,
  connectGithubVault,
  createE2eGithubRepoName,
  deleteSecret,
  githubPat,
  assertVaultReady,
  reconnectGithubVault,
  resetGithubVault,
  revealSecretInRow,
  finishE2eGithubSuite,
  uniqueSecretKey,
} from './helpers'

const describeGithub = githubPat ? test.describe : test.describe.skip

describeGithub('github vault', () => {
  test.describe.configure({ mode: 'serial' })

  let vaultPage: Page
  let e2eRepo: string

  test.beforeAll(async ({ browser }) => {
    e2eRepo = createE2eGithubRepoName()
    await resetGithubVault(githubPat, e2eRepo)
    vaultPage = await browser.newPage()
    await vaultPage.goto('/')
    await clearBrowserVault(vaultPage)
    await vaultPage.reload()
    await connectGithubVault(vaultPage, githubPat, e2eRepo)
  })

  test.afterAll(async () => {
    await vaultPage?.close()
    await finishE2eGithubSuite(githubPat, e2eRepo)
  })

  test('connects and shows vault after github sync', async () => {
    await expect(vaultPage.getByTestId('vault-panel')).toBeVisible()
    await expect(vaultPage.getByTestId('vault-status-bar')).toContainText(
      'Local vault',
    )
    await expect(vaultPage.getByTestId('vault-sync-out-status')).toContainText(
      'sync provider',
    )
  })

  test('adds and deletes a secret synced to github', async () => {
    const key = uniqueSecretKey('e2e-github')
    const value = 'github-sync-secret'

    await addSecret(vaultPage, key, value, {
      pat: githubPat,
      repoName: e2eRepo,
    })
    await deleteSecret(vaultPage, key, { pat: githubPat, repoName: e2eRepo })
  })

  test('persists secrets across reload and reconnect', async () => {
    const key = uniqueSecretKey('e2e-github-persist')
    const value = 'github-persist-value'

    await addSecret(vaultPage, key, value, {
      pat: githubPat,
      repoName: e2eRepo,
    })
    await vaultPage.reload()
    await vaultPage.waitForLoadState('domcontentloaded')
    await reconnectGithubVault(vaultPage)
    await assertVaultReady(vaultPage)

    const row = vaultPage.getByTestId('secret-row').filter({ hasText: key })
    await row.waitFor()
    await revealSecretInRow(row)
    await row.getByText(value).waitFor()

    await deleteSecret(vaultPage, key, { pat: githubPat, repoName: e2eRepo })
  })
})
