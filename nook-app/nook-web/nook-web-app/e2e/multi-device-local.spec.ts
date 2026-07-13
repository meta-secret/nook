import { test, expect, type BrowserContext, type Page } from './fixtures'
import {
  approveJoinLocalE2eFromBanner,
  assertVaultReady,
  connectLocalE2eJoinerDevice,
  connectLocalVault,
  createIsolatedContext,
  disableVaultIdleLock,
  E2E_SYNC_ONBOARD_PROVIDER,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  NOTIFICATION_TIMEOUT_MS,
  readLocalVaultYamlFromIdb,
  reloadUnlockLocalVaultWithSync,
  sendJoinRequestLocalE2e,
  triggerVaultSyncRefresh,
  waitForSyncRemoteVaultState,
  waitForPendingJoinBanner,
} from './helpers'
import { createLocalE2eFileSyncVaultStub } from './file-sync-stub'

test.describe('multi-device local vault with sync provider', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(120_000)

  const fileName = E2E_SYNC_ONBOARD_PROVIDER.fileName
  let deviceA: Page
  let deviceB: Page
  let contextA: BrowserContext
  let contextB: BrowserContext
  let stub: ReturnType<typeof createLocalE2eFileSyncVaultStub>

  test.beforeAll(async ({ browser }) => {
    contextA = await createIsolatedContext(browser)
    contextB = await createIsolatedContext(browser)
    deviceA = await contextA.newPage()
    deviceB = await contextB.newPage()
    await disableVaultIdleLock(deviceB)

    await connectLocalVault(deviceA)
    await assertVaultReady(deviceA)

    const genesisYaml = await readLocalVaultYamlFromIdb(deviceA)
    stub = createLocalE2eFileSyncVaultStub(genesisYaml, fileName)
    await stub.install(deviceA, { fileName, vaultYaml: genesisYaml })
    await stub.install(deviceB, { fileName, vaultYaml: genesisYaml })

    await reloadUnlockLocalVaultWithSync(deviceA, stub)
    await triggerVaultSyncRefresh(deviceA)
    await expect(deviceA.getByTestId('vault-last-sync')).toContainText(
      /just now|s ago/,
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    await waitForSyncRemoteVaultState(
      stub,
      (snapshot) =>
        snapshot.authPkIds.length >= 1 && snapshot.memberPkIds.length >= 1,
    )
  })

  test.afterAll(async () => {
    await deviceA?.close()
    await deviceB?.close()
    await contextA?.close()
    await contextB?.close()
  })

  test('joiner sends a request to the stubbed sync provider', async () => {
    await connectLocalE2eJoinerDevice(deviceB, fileName)
    const join = await sendJoinRequestLocalE2e(deviceB, stub)

    expect(join.deviceId).toMatch(/^[a-f0-9]{16}$/)
    expect(join.publicKey).toMatch(/^age1/)
    await waitForSyncRemoteVaultState(
      stub,
      (snapshot) => snapshot.joinEntries.length === 1,
    )
  })

  test('genesis device sees pending join after sync refresh', async () => {
    const join = (
      await waitForSyncRemoteVaultState(
        stub,
        (snapshot) => snapshot.joinEntries.length === 1,
      )
    ).joinEntries[0]!

    await triggerVaultSyncRefresh(deviceA)
    await expect(deviceA.getByTestId('vault-last-sync')).toContainText(
      /just now|s ago/,
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    await waitForPendingJoinBanner(deviceA, join.deviceId)
    await expect(
      deviceA.getByTestId('device-join-row').filter({ hasText: join.deviceId }),
    ).toBeVisible()
  })

  test('genesis device approves join and fan-out updates the stub', async () => {
    const join = await parseJoinFromStub(stub)

    await approveJoinLocalE2eFromBanner(deviceA, join.deviceId, stub, 2)
  })

  test('genesis device eventually sees pending join without manual refresh', async () => {
    test.setTimeout(200_000)
    await connectLocalE2eJoinerDevice(deviceB, fileName)
    const join = await sendJoinRequestLocalE2e(deviceB, stub)

    await expect
      .poll(
        () =>
          waitForSyncRemoteVaultState(
            stub,
            (snapshot) => snapshot.joinEntries.length >= 1,
            { timeoutMs: 1_000 },
          ).then(
            (snapshot) => snapshot.joinEntries.length,
            () => 0,
          ),
        {
          timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
        },
      )
      .toBeGreaterThanOrEqual(1)

    await expect
      .poll(
        async () => {
          if (await deviceA.getByTestId('pending-joins-banner').isVisible()) {
            return true
          }
          await deviceA.evaluate(async () => {
            const vault = (
              window as Window & {
                __nookVault?: {
                  syncFromStorage?: (opts?: {
                    force?: boolean
                  }) => Promise<void>
                }
              }
            ).__nookVault
            await vault?.syncFromStorage?.({ force: true })
          })
          await deviceA.evaluate(async () => {
            const vault = (
              window as Window & {
                __nookVault?: {
                  refreshPendingJoinsFromProviders?: () => Promise<void>
                }
              }
            ).__nookVault
            await vault?.refreshPendingJoinsFromProviders?.()
          })
          return deviceA.getByTestId('pending-joins-banner').isVisible()
        },
        { timeout: NOTIFICATION_TIMEOUT_MS },
      )
      .toBe(true)
    await expect(
      deviceA.getByTestId('device-join-row').filter({ hasText: join.deviceId }),
    ).toBeVisible()
  })
})

async function parseJoinFromStub(stub: {
  getEventFileContents: () => string[]
}) {
  const snapshot = await waitForSyncRemoteVaultState(
    stub,
    (state) => state.joinEntries.length > 0,
  )
  if (snapshot.joinEntries.length === 0) {
    throw new Error('Expected a pending join entry in remote event log')
  }
  return snapshot.joinEntries[0]!
}
