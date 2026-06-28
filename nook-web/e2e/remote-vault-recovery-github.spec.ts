import { expect, test, type Page } from '@playwright/test'
import {
  addSecret,
  assertVaultReady,
  clearBrowserVault,
  disableLoginAutoUnlock,
  removeE2eDummyGithubSyncProvider,
  revealSecretInRow,
  UI_TIMEOUT_MS,
  uniqueSecretKey,
  unlockVaultOnLogin,
  waitForGithubVaultState,
  waitForSecretOnDevice,
} from './helpers'
import {
  createSyncTarget,
  installSyncStub,
  connectSyncVault,
  resetSyncRemote,
  type SyncE2eTarget,
} from './sync-provider'

test.describe('remote vault recovery (stub sync, local-first)', () => {
  test.describe.configure({ mode: 'serial' })

  let vaultPage: Page
  let target: SyncE2eTarget

  test.beforeAll(async ({ browser }) => {
    target = createSyncTarget('', 'remote-recovery')
    vaultPage = await browser.newPage()
    await installSyncStub(vaultPage, target)
    await vaultPage.goto('/')
    await clearBrowserVault(vaultPage)
    await vaultPage.reload()
    await connectSyncVault(vaultPage, target)
    await disableLoginAutoUnlock(vaultPage)
  })

  test.afterAll(async () => {
    await vaultPage?.close()
  })

  test('unlocks from local vault and re-syncs after remote file was deleted', async () => {
    const key = uniqueSecretKey('e2e-recover')
    const value = 'recovered-from-local-vault'

    await addSecret(vaultPage, key, value, target)
    resetSyncRemote(target)

    await vaultPage.reload()
    await expect(vaultPage.getByTestId('login-gate')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })

    await unlockVaultOnLogin(vaultPage)
    await assertVaultReady(vaultPage)

    await waitForSecretOnDevice(vaultPage, key)
    const row = vaultPage.getByTestId('secret-row').filter({ hasText: key })
    await revealSecretInRow(row)
    await row.getByText(value).waitFor()

    await removeE2eDummyGithubSyncProvider(vaultPage)
    await vaultPage.getByTestId('vault-sync-refresh-btn').click()
    await waitForGithubVaultState(
      target,
      (yaml) => yaml.secretIds.length >= 1,
      { page: vaultPage },
    )
  })
})
