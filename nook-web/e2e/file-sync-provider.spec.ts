import { test, expect, type BrowserContext, type Page } from './fixtures'
import {
  addSecret,
  approveJoinFromBanner,
  assertVaultReady,
  createIsolatedContext,
  disableVaultIdleLock,
  revealSecretValue,
  sendJoinRequestLocalE2e,
  uniqueSecretKey,
  waitForJoinerVaultReady,
  waitForSecretOnDevice,
} from './helpers'
import {
  connectSyncGenesisDevice,
  connectSyncJoinerDevice,
  createSyncTarget,
  installSyncStubOnPages,
  waitForSyncRemoteState,
  type SyncE2eTarget,
} from './sync-provider'

test.describe('file sync provider event log', () => {
  test.setTimeout(120_000)

  let contextA: BrowserContext
  let contextB: BrowserContext
  let deviceA: Page
  let deviceB: Page
  let target: SyncE2eTarget

  test.beforeAll(async ({ browser }) => {
    contextA = await createIsolatedContext(browser)
    contextB = await createIsolatedContext(browser)
    deviceA = await contextA.newPage()
    deviceB = await contextB.newPage()
    await disableVaultIdleLock(deviceA)
    await disableVaultIdleLock(deviceB)
    target = createSyncTarget('', 'file-sync', 'file')
    await installSyncStubOnPages([deviceA, deviceB], target)
  })

  test.afterAll(async () => {
    await deviceA?.close()
    await deviceB?.close()
    await contextA?.close()
    await contextB?.close()
  })

  test('stores flat YAML events on disk and replicates across browsers', async () => {
    const stub = target.stub
    if (!stub || !('getRootDir' in stub) || !('getEventFilePaths' in stub)) {
      throw new Error('file sync target did not create a file-backed stub')
    }

    await connectSyncGenesisDevice(deviceA, target)
    await assertVaultReady(deviceA)

    const key = uniqueSecretKey('e2e-file-sync')
    const value = 'file-backed-event-log-value'
    await addSecret(deviceA, key, value, target)

    await waitForSyncRemoteState(
      target,
      (snapshot) => snapshot.secretIds.length >= 1,
    )
    expect(stub.getRootDir()).toContain('nook-e2e-file-sync-')
    expect(stub.getEventFilePaths()).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^nook-log\/v1\/events\/[a-f0-9]{64}\.yaml$/),
      ]),
    )
    expect(stub.getEventFilePaths()).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^nook-log\/v1\/events\/[a-f0-9]{2}\//),
      ]),
    )
    expect(stub.getEventFileContents()).toEqual(
      expect.arrayContaining([expect.stringContaining('schema_version:')]),
    )

    await connectSyncJoinerDevice(deviceB, target)
    const join = await sendJoinRequestLocalE2e(deviceB, stub)
    await approveJoinFromBanner(deviceA, join.deviceId, target, 2)
    await waitForJoinerVaultReady(deviceB, target)

    await waitForSecretOnDevice(deviceB, key, target)
    expect(await revealSecretValue(deviceB, key)).toBe(value)
  })
})
