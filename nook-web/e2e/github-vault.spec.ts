import { test, expect, type Page } from '@playwright/test'
import {
  addSecret,
  clearBrowserVault,
  connectGithubVault,
  deleteSecret,
  githubPat,
  assertVaultReady,
  reconnectGithubVault,
  resetGithubVault,
  uniqueSecretKey,
} from './helpers'

const describeGithub = githubPat ? test.describe : test.describe.skip

describeGithub('github vault', () => {
  test.describe.configure({ mode: 'serial' })

  let vaultPage: Page

  test.beforeAll(async ({ browser }) => {
    await resetGithubVault(githubPat)
    vaultPage = await browser.newPage()
    await vaultPage.goto('/')
    await clearBrowserVault(vaultPage)
    await vaultPage.reload()
    await connectGithubVault(vaultPage, githubPat)
  })

  test.afterAll(async () => {
    await vaultPage?.close()
    await resetGithubVault(githubPat)
  })

  test('connects and shows vault after github sync', async () => {
    await expect(vaultPage.getByTestId('vault-panel')).toBeVisible()
    await expect(vaultPage.getByTestId('storage-status-chip')).toContainText(
      'GitHub',
    )
  })

  test('adds and deletes a secret synced to github', async () => {
    const key = uniqueSecretKey('e2e-github')
    const value = 'github-sync-secret'

    await addSecret(vaultPage, key, value)
    await deleteSecret(vaultPage, key)
  })

  test('persists secrets across reload and reconnect', async () => {
    const key = uniqueSecretKey('e2e-github-persist')
    const value = 'github-persist-value'

    await addSecret(vaultPage, key, value)
    await vaultPage.reload()
    await vaultPage.waitForLoadState('domcontentloaded')
    await reconnectGithubVault(vaultPage)
    await assertVaultReady(vaultPage)

    const row = vaultPage.getByTestId('secret-row').filter({ hasText: key })
    await row.waitFor()
    await row.getByRole('button', { name: 'Show password' }).click()
    await row.getByText(value).waitFor()

    await deleteSecret(vaultPage, key)
  })
})
