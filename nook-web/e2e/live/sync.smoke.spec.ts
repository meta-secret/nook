import { test, expect, type Page } from '@playwright/test'
import {
  addSecret,
  clearBrowserVault,
  createE2eGithubRepoName,
  deleteSecret,
  finishE2eGithubSuite,
  resetGithubVault,
  uniqueSecretKey,
} from '../helpers'
import {
  connectSyncVault,
  e2eSyncProviderDef,
  hasLiveSyncCredential,
  liveSyncCredential,
  resolveE2eSyncProvider,
  type SyncE2eTarget,
} from '../sync-provider'

const providerId = resolveE2eSyncProvider()
const providerDef = e2eSyncProviderDef(providerId)
const describeLive = hasLiveSyncCredential(providerId)
  ? test.describe
  : test.describe.skip

/**
 * Nightly smoke: one real API round-trip per provider job.
 * CI sets `NOOK_E2E_SYNC_PROVIDER` per matrix row; stub coverage is sync-stub project.
 */
describeLive(`live ${providerDef.label} sync smoke`, () => {
  test.describe.configure({ mode: 'serial' })

  let vaultPage: Page
  let target: SyncE2eTarget

  test.beforeAll(async ({ browser }) => {
    if (providerId === 'github') {
      const repoName = createE2eGithubRepoName()
      const pat = liveSyncCredential('github')
      await resetGithubVault(pat, repoName)
      target = { providerId: 'github', pat, repoName }
    } else {
      throw new Error(`${providerDef.label} live smoke not wired yet`)
    }

    vaultPage = await browser.newPage()
    await vaultPage.goto('/')
    await clearBrowserVault(vaultPage)
    await vaultPage.reload()
    await connectSyncVault(vaultPage, target)
  })

  test.afterAll(async () => {
    await vaultPage?.close()
    if (providerId === 'github') {
      await finishE2eGithubSuite(target.pat, target.repoName)
    }
  })

  test('connects and syncs a secret to the real remote', async () => {
    await expect(vaultPage.getByTestId('vault-panel')).toBeVisible()
    const key = uniqueSecretKey('e2e-live-smoke')
    await addSecret(vaultPage, key, 'live-smoke-value', target)
    await deleteSecret(vaultPage, key, target)
  })
})
