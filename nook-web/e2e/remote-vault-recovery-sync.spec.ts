import { expect, test, type Page } from './fixtures'
import {
  addSecret,
  assertVaultReady,
  clearBrowserVault,
  connectLocalVault,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  installPasskeyMock,
  disableLoginAutoUnlock,
  removeE2eDummyGithubSyncProvider,
  reloadUnlockWithSyncProvider,
  revealSecretInRow,
  UI_TIMEOUT_MS,
  uniqueSecretKey,
  unlockVaultOnLogin,
  waitForLoadedSyncProviders,
  waitForSecretOnDevice,
  waitForVaultOperationsIdle,
} from './helpers'
import {
  createSyncTarget,
  installSyncStub,
  resetSyncRemote,
  waitForSyncRemoteState,
  type SyncE2eTarget,
} from './sync-provider'
import type { createLocalE2eGoogleDriveVaultStub } from './drive-stub'

test.describe('remote vault recovery (stub sync, local-first)', () => {
  test.describe.configure({ mode: 'serial' })

  let vaultPage: Page
  let target: SyncE2eTarget

  test.beforeAll(async ({ browser }) => {
    target = createSyncTarget('', 'remote-recovery')
    vaultPage = await browser.newPage()
    await installPasskeyMock(vaultPage)
    await installSyncStub(vaultPage, target)
    await vaultPage.goto('/')
    await clearBrowserVault(vaultPage)
    await vaultPage.reload()
    await connectLocalVault(vaultPage)
    await disableLoginAutoUnlock(vaultPage)
    await reloadUnlockWithSyncProvider(vaultPage, {
      providers: [
        {
          id: 'e2e-remote-recovery',
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

  test('unlocks from local vault and re-syncs after remote file was deleted', async () => {
    const key = uniqueSecretKey('e2e-recover')
    const value = 'recovered-from-local-vault'

    await addSecret(vaultPage, key, value, target)
    resetSyncRemote(target)

    await vaultPage.reload()
    await installSyncStub(vaultPage, target)

    await expect(vaultPage.getByTestId('login-gate')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })

    await unlockVaultOnLogin(vaultPage)
    await assertVaultReady(vaultPage)
    await waitForLoadedSyncProviders(vaultPage)

    await waitForSecretOnDevice(vaultPage, key)
    const row = vaultPage.getByTestId('secret-row').filter({ hasText: key })
    await revealSecretInRow(row)
    await row.getByText(value).waitFor()

    await removeE2eDummyGithubSyncProvider(vaultPage)
    await expect
      .poll(
        async () => {
          await waitForVaultOperationsIdle(vaultPage)
          await vaultPage.evaluate(async () => {
            const vault = (
              window as Window & {
                __nookVault?: {
                  manualSync?: () => Promise<void>
                  runFanOutSyncAfterLocalSave?: () => Promise<void>
                }
              }
            ).__nookVault
            await vault?.runFanOutSyncAfterLocalSave?.()
            await vault?.manualSync?.()
          })
          await waitForVaultOperationsIdle(vaultPage)
          const snapshot = await waitForSyncRemoteState(
            target,
            (state) => state.secretIds.length >= 1,
            { timeoutMs: 1_000 },
          ).catch(() => null)
          return snapshot?.secretIds.length ?? 0
        },
        { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
      )
      .toBeGreaterThanOrEqual(1)
  })
})
