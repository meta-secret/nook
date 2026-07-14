import { test, expect, type BrowserContext, type Page } from './fixtures'
import {
  addSecret,
  approveJoinFromBanner,
  assertVaultReady,
  createIsolatedContext,
  disableVaultIdleLock,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  revealSecretValue,
  seedExtraOauthFileProviders,
  sendJoinRequestLocalE2e,
  uniqueSecretKey,
  waitForLoadedSyncProviders,
  waitForJoinerVaultReady,
  waitForSecretOnDevice,
  waitForVaultOperationsIdle,
} from './helpers'
import {
  connectSyncGenesisDevice,
  connectSyncJoinerDevice,
  createSyncTarget,
  installSyncRemote,
  installSyncRemoteOnPages,
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
    await installSyncRemoteOnPages([deviceA, deviceB], target)
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
      throw new Error('file sync target did not create a file-backed remote')
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
        expect.stringMatching(
          /^nook-log\/v1\/events\/[A-Za-z0-9_-]{43}\.yaml$/,
        ),
      ]),
    )
    expect(stub.getEventFilePaths()).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^nook-log\/v1\/events\/[^/]+\//),
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

  test('replicates secure-note events across primary and per-device file backups', async () => {
    const commonVault = createIsolatedFileTarget(
      'file-repl-common-vault',
      'common-vault',
    )
    const commonVaultBackup = createIsolatedFileTarget(
      'file-repl-common-vault-backup',
      'common-vault-backup',
    )
    const vault2Backup = createIsolatedFileTarget(
      'file-repl-vault2-backup',
      'vault2-backup',
    )

    await connectSyncGenesisDevice(deviceA, commonVault)
    await assertVaultReady(deviceA)
    await waitForFileEvents(commonVault, 1)

    await addFileBackupProvider(deviceA, commonVaultBackup, {
      id: 'e2e-common-vault-backup',
      label: 'File common-vault-backup',
      minProviderCount: 2,
    })
    await expectFileTargetsToHaveSameEvents([commonVault, commonVaultBackup])

    await connectSyncJoinerDevice(deviceB, commonVault)
    const join = await sendJoinRequestLocalE2e(deviceB, commonVault.stub!)
    await approveJoinFromBanner(deviceA, join.deviceId, commonVault, 2)
    await waitForJoinerVaultReady(deviceB, commonVault)
    await assertVaultReady(deviceB)

    await addFileBackupProvider(deviceB, vault2Backup, {
      id: 'e2e-vault2-backup',
      label: 'File vault2-backup',
      minProviderCount: 2,
    })

    const noteTitle = uniqueSecretKey('e2e-repl-note')
    const noteBody = '# Replication proof\n\nSaved on device 1.'
    await addSecureNote(deviceA, noteTitle, noteBody)
    await flushFileProviders(deviceA)
    await waitForSyncRemoteState(
      commonVault,
      (snapshot) =>
        snapshot.secretIds.length >= 1 && snapshot.raw.includes('secure-note'),
    )
    await flushFileProviders(deviceB)
    await waitForSyncRemoteState(
      vault2Backup,
      (snapshot) =>
        snapshot.secretIds.length >= 1 && snapshot.raw.includes('secure-note'),
    )

    await expectFileTargetsToHaveSameEvents([
      commonVault,
      commonVaultBackup,
      vault2Backup,
    ])
  })
})

function createIsolatedFileTarget(prefix: string, tokenSuffix: string) {
  const target = createSyncTarget('', prefix, 'file')
  return {
    ...target,
    pat: `ya29.e2e_${tokenSuffix}_${Date.now()}`,
  }
}

function fileStub(target: SyncE2eTarget) {
  const stub = target.stub
  if (
    !stub ||
    !('getEventFilePaths' in stub) ||
    !('getEventFileCount' in stub)
  ) {
    throw new Error(`Expected file-backed sync target for ${target.repoName}`)
  }
  return stub
}

async function waitForFileEvents(
  target: SyncE2eTarget,
  minCount: number,
): Promise<string[]> {
  const stub = fileStub(target)
  await expect
    .poll(() => stub.getEventFileCount(), {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    .toBeGreaterThanOrEqual(minCount)
  return stub.getEventFilePaths().sort()
}

async function expectFileTargetsToHaveSameEvents(targets: SyncE2eTarget[]) {
  const [primary, ...backups] = targets
  if (!primary) throw new Error('Expected at least one file target')

  const primaryPaths = await waitForFileEvents(primary, 1)
  for (const backup of backups) {
    await expect
      .poll(() => fileStub(backup).getEventFilePaths().sort(), {
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })
      .toEqual(primaryPaths)
  }
}

async function addFileBackupProvider(
  page: Page,
  target: SyncE2eTarget,
  opts: { id: string; label: string; minProviderCount: number },
) {
  // Provider snapshots must not be mutated while periodic sync is loading the
  // same snapshot, or the in-flight read can restore the previous provider set.
  await waitForVaultOperationsIdle(page)
  await installSyncRemote(page, target)
  await seedExtraOauthFileProviders(page, [
    {
      id: opts.id,
      label: opts.label,
      fileName: target.repoName,
      accessToken: target.pat,
      accountEmail: `${opts.id}@e2e.local`,
    },
  ])
  await page.evaluate(async () => {
    const vault = (
      window as Window & {
        __nookVault?: { loadProviders?: () => Promise<void> }
      }
    ).__nookVault
    await vault?.loadProviders?.()
  })
  await waitForLoadedSyncProviders(page, opts.minProviderCount)
  await flushFileProviders(page)
  await waitForFileEvents(target, 1)
}

async function addSecureNote(page: Page, title: string, body: string) {
  await assertVaultReady(page)
  await waitForVaultOperationsIdle(page)
  await page.getByTestId('add-secret-btn').click()
  await page.getByTestId('item-type-secure-note').click()
  await page.getByTestId('secret-label').fill(title)
  await page.getByTestId('secret-value').fill(body)
  await page.getByTestId('save-secret-btn').click()
  await waitForVaultOperationsIdle(page)
  await expect(
    page.getByTestId('secret-row').filter({ hasText: title }),
  ).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
}

async function flushFileProviders(page: Page) {
  await page.evaluate(async () => {
    const vault = (
      window as Window & {
        __nookVault?: {
          manualSync?: () => Promise<void>
          runFanOutSyncAfterLocalSave?: () => Promise<void>
        }
      }
    ).__nookVault
    await vault?.manualSync?.()
    await vault?.runFanOutSyncAfterLocalSave?.()
  })
  await waitForVaultOperationsIdle(page)
}
