import { test, expect, type Page } from './fixtures'
import {
  addSecret,
  clearBrowserVault,
  connectLocalVault,
  deleteSecret,
  assertVaultReady,
  reconnectSyncVault,
  reloadUnlockWithSyncProvider,
  revealSecretInRow,
  installPasskeyMock,
  uniqueSecretKey,
  waitForLoadedSyncProviders,
} from './helpers'
import {
  createSyncTarget,
  e2eSyncProviderDef,
  installSyncRemote,
  isOauthFileSyncTarget,
  resolveE2eSyncProvider,
  type OAuthFileSyncE2eTarget,
} from './sync-provider'

const providerId = resolveE2eSyncProvider()
const providerLabel = e2eSyncProviderDef(providerId).label

test.describe(`${providerLabel} vault`, () => {
  test.describe.configure({ mode: 'serial' })

  let vaultPage: Page
  let target: OAuthFileSyncE2eTarget

  test.beforeAll(async ({ browser }) => {
    const syncTarget = createSyncTarget('', 'sync-vault', providerId)
    if (!isOauthFileSyncTarget(syncTarget)) {
      throw new Error(
        `sync-vault requires an OAuth file provider, received ${syncTarget.providerId}`,
      )
    }
    target = syncTarget
    vaultPage = await browser.newPage()
    await installPasskeyMock(vaultPage)
    await installSyncRemote(vaultPage, target)
    await vaultPage.goto('/app/')
    await clearBrowserVault(vaultPage)
    await vaultPage.reload()
    await connectLocalVault(vaultPage)
    await reloadUnlockWithSyncProvider(vaultPage, {
      providers: [
        {
          id: 'e2e-sync-vault',
          label: 'File',
          fileName: target.repoName,
          accessToken: target.pat,
        },
      ],
      sharedStub: target.stub,
    })
    await waitForLoadedSyncProviders(vaultPage)
  })

  test.afterAll(async () => {
    await vaultPage?.close()
  })

  test('connects and shows vault after sync', async () => {
    await expect(vaultPage.getByTestId('vault-panel')).toBeVisible()
    await expect(vaultPage.getByTestId('vault-status-bar')).toContainText(
      'Vault',
    )
    await expect(vaultPage.getByTestId('vault-sync-out-status')).toContainText(
      'sync provider',
    )
  })

  test('adds and deletes a secret synced to remote', async () => {
    const key = uniqueSecretKey('e2e-sync')
    const value = 'sync-secret'

    await addSecret(vaultPage, key, value, target)
    await deleteSecret(vaultPage, key, target)
  })

  test('persists secrets across reload and reconnect', async () => {
    const key = uniqueSecretKey('e2e-sync-persist')
    const value = 'sync-persist-value'

    await addSecret(vaultPage, key, value, target)
    await vaultPage.reload()
    await vaultPage.waitForLoadState('domcontentloaded')
    await installSyncRemote(vaultPage, target)
    await reconnectSyncVault(vaultPage)
    await assertVaultReady(vaultPage)
    await waitForLoadedSyncProviders(vaultPage)

    const row = vaultPage.getByTestId('secret-row').filter({ hasText: key })
    await row.waitFor()
    await revealSecretInRow(row)
    await row.getByText(value).waitFor()

    await deleteSecret(vaultPage, key, target)
  })
})
