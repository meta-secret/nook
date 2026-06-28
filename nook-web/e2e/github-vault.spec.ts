import { test, expect, type Page } from '@playwright/test'
import {
  addSecret,
  clearBrowserVault,
  connectGithubVault,
  deleteSecret,
  assertVaultReady,
  reconnectGithubVault,
  revealSecretInRow,
  uniqueSecretKey,
} from './helpers'
import {
  createStubSyncTarget,
  installStubOnPage,
  type StubSyncTarget,
} from './sync-stub'

test.describe('github vault (stub sync)', () => {
  test.describe.configure({ mode: 'serial' })

  let vaultPage: Page
  let target: StubSyncTarget

  test.beforeAll(async ({ browser }) => {
    target = createStubSyncTarget('', 'github-vault')
    vaultPage = await browser.newPage()
    await installStubOnPage(vaultPage, target)
    await vaultPage.goto('/')
    await clearBrowserVault(vaultPage)
    await vaultPage.reload()
    await connectGithubVault(
      vaultPage,
      target.pat,
      target.repoName,
      target.stub,
    )
  })

  test.afterAll(async () => {
    await vaultPage?.close()
  })

  test('connects and shows vault after github sync', async () => {
    await expect(vaultPage.getByTestId('vault-panel')).toBeVisible()
    await expect(vaultPage.getByTestId('vault-status-bar')).toContainText(
      'Vault',
    )
    await expect(vaultPage.getByTestId('vault-sync-out-status')).toContainText(
      'sync provider',
    )
  })

  test('adds and deletes a secret synced to github', async () => {
    const key = uniqueSecretKey('e2e-github')
    const value = 'github-sync-secret'

    await addSecret(vaultPage, key, value, target)
    await deleteSecret(vaultPage, key, target)
  })

  test('persists secrets across reload and reconnect', async () => {
    const key = uniqueSecretKey('e2e-github-persist')
    const value = 'github-persist-value'

    await addSecret(vaultPage, key, value, target)
    await vaultPage.reload()
    await vaultPage.waitForLoadState('domcontentloaded')
    await reconnectGithubVault(vaultPage)
    await assertVaultReady(vaultPage)

    const row = vaultPage.getByTestId('secret-row').filter({ hasText: key })
    await row.waitFor()
    await revealSecretInRow(row)
    await row.getByText(value).waitFor()

    await deleteSecret(vaultPage, key, target)
  })
})
