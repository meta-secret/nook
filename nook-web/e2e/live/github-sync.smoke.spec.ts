import { test, expect, type Page } from '@playwright/test'
import {
  addSecret,
  clearBrowserVault,
  connectGithubVault,
  createE2eGithubRepoName,
  deleteSecret,
  finishE2eGithubSuite,
  githubPat,
  resetGithubVault,
  uniqueSecretKey,
} from '../helpers'

const describeLive = githubPat ? test.describe : test.describe.skip

/**
 * Nightly smoke: one real GitHub API round-trip per run.
 * Stub-backed coverage lives in the main e2e suite (sync-stub project).
 */
describeLive('live GitHub sync smoke', () => {
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
  })

  test.afterAll(async () => {
    await vaultPage?.close()
    await finishE2eGithubSuite(githubPat, e2eRepo)
  })

  test('connects and syncs a secret to a real GitHub repo', async () => {
    await expect(vaultPage.getByTestId('vault-panel')).toBeVisible()
    const key = uniqueSecretKey('e2e-live-smoke')
    await addSecret(vaultPage, key, 'live-smoke-value', target())
    await deleteSecret(vaultPage, key, target())
  })
})
