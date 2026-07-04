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
  installSyncStub,
  resolveE2eSyncProvider,
  type SyncE2eTarget,
} from './sync-provider'
import type { createLocalE2eGoogleDriveVaultStub } from './drive-stub'

const providerId = resolveE2eSyncProvider()
const providerLabel = e2eSyncProviderDef(providerId).label

test.describe(`${providerLabel} vault (stub sync)`, () => {
  test.describe.configure({ mode: 'serial' })

  let vaultPage: Page
  let target: SyncE2eTarget

  test.beforeAll(async ({ browser }) => {
    target = createSyncTarget('', 'sync-vault')
    vaultPage = await browser.newPage()
    await installPasskeyMock(vaultPage)
    await installSyncStub(vaultPage, target)
    await vaultPage.goto('/')
    await clearBrowserVault(vaultPage)
    await vaultPage.reload()
    await connectLocalVault(vaultPage)
    await reloadUnlockWithSyncProvider(vaultPage, {
      providers: [
        {
          id: 'e2e-sync-vault',
          label: 'E2E Drive',
          fileName: target.repoName,
          accessToken: target.pat,
        },
      ],
      sharedStub: target.stub as ReturnType<
        typeof createLocalE2eGoogleDriveVaultStub
      >,
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
    await installSyncStub(vaultPage, target)
    await reconnectSyncVault(vaultPage)
    await assertVaultReady(vaultPage)

    const row = vaultPage.getByTestId('secret-row').filter({ hasText: key })
    await row.waitFor()
    await revealSecretInRow(row)
    await row.getByText(value).waitFor()

    await deleteSecret(vaultPage, key, target)
  })
})
