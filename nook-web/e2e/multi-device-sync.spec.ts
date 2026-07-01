import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import {
  addSecret,
  approveJoinFromBanner,
  approveJoinFromSettings,
  assertEnrolledVaultOnGithub,
  assertVaultReady,
  createIsolatedContext,
  disableVaultIdleLock,
  expandSettingsSection,
  openStorageSettings,
  revealSecretValue,
  sendJoinRequest,
  unlockGithubVault,
  triggerVaultSyncRefresh,
  waitForPendingJoinBanner,
  uniqueSecretKey,
  UI_TIMEOUT_MS,
  NOTIFICATION_TIMEOUT_MS,
  waitForGithubVaultState,
  waitForSecretOnDevice,
  waitForVaultOperationsIdle,
} from './helpers'
import { parseVaultYamlSnapshot, assertGenesisVaultYaml } from './vault-yaml'
import {
  createSyncTarget,
  installSyncStubOnPages,
  connectSyncGenesisDevice,
  connectSyncJoinerDevice,
  e2eSyncProviderDef,
  resolveE2eSyncProvider,
  type SyncE2eTarget,
} from './sync-provider'

const providerLabel = e2eSyncProviderDef(resolveE2eSyncProvider()).label

// One worker per file — nested describes share stub timing and must not overlap.
test.describe.configure({ mode: 'serial' })

test.describe(`multi-device ${providerLabel} vault (stub sync)`, () => {
  test.setTimeout(120_000)

  let deviceA: Page
  let deviceB: Page
  let contextA: BrowserContext
  let contextB: BrowserContext
  let target: SyncE2eTarget

  const genesisSecretKey = uniqueSecretKey('e2e-md-genesis')
  const genesisSecretValue = 'genesis-device-password'
  const joinerSecretKey = uniqueSecretKey('e2e-md-joiner')
  const joinerSecretValue = 'joiner-device-password-пароль'

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000)
    target = createSyncTarget('', 'multi-device')

    contextA = await createIsolatedContext(browser)
    contextB = await createIsolatedContext(browser)
    deviceA = await contextA.newPage()
    deviceB = await contextB.newPage()
    await disableVaultIdleLock(deviceB)

    await installSyncStubOnPages([deviceA, deviceB], target)
    await connectSyncGenesisDevice(deviceA, target)
    await disableVaultIdleLock(deviceA)
    await waitForVaultOperationsIdle(deviceA)
    await addSecret(deviceA, genesisSecretKey, genesisSecretValue, target)

    const genesisYaml = await waitForGithubVaultState(
      target,
      (yaml) =>
        yaml.authPkIds.length >= 1 &&
        yaml.memberPkIds.length >= 1 &&
        yaml.secretIds.length >= 1,
    )
    assertGenesisVaultYaml(genesisYaml)
    expect(genesisYaml.authPkIds).toHaveLength(1)
    expect(genesisYaml.memberPkIds).toHaveLength(1)
  })

  test.afterAll(async () => {
    await deviceA?.close()
    await deviceB?.close()
    await contextA?.close()
    await contextB?.close()
  })

  test('device B sees join dialog and sends a join request', async () => {
    await connectSyncJoinerDevice(deviceB, target)
    const join = await sendJoinRequest(
      deviceB,
      target.pat,
      target.repoName,
      target.stub,
    )

    expect(join.deviceId).toMatch(/^[a-f0-9]{16}$/)
    expect(join.publicKey).toMatch(/^age1/)

    const yaml = await waitForGithubVaultState(
      target,
      (snapshot) => snapshot.joinEntries.length === 1,
    )
    expect(yaml.joinEntries[0].deviceId).toBe(join.deviceId)
    expect(yaml.joinEntries[0].publicKey).toBe(join.publicKey)
  })

  test('device A sees pending join after manual vault refresh', async () => {
    const join = (
      await waitForGithubVaultState(
        target,
        (snapshot) => snapshot.joinEntries.length === 1,
      )
    ).joinEntries[0]

    await triggerVaultSyncRefresh(deviceA)
    await expect(deviceA.getByTestId('vault-last-sync')).toContainText(
      /just now|s ago/,
      { timeout: UI_TIMEOUT_MS },
    )
    await waitForPendingJoinBanner(deviceA, join.deviceId)
  })

  test('device A sees pending join and approves from banner', async () => {
    const join = (
      await waitForGithubVaultState(
        target,
        (snapshot) => snapshot.joinEntries.length === 1,
      )
    ).joinEntries[0]

    await expect(deviceA.getByTestId('pending-joins-banner')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })

    await approveJoinFromBanner(deviceA, join.deviceId, target, 2)

    const enrolledYaml = await assertEnrolledVaultOnGithub(target, 2)
    expect(enrolledYaml.secretIds).toHaveLength(1)
    expect(enrolledYaml.authPkIds).toHaveLength(2)
    expect(enrolledYaml.memberPkIds).toHaveLength(2)
    expect(new Set(enrolledYaml.authPkIds).size).toBe(2)
    expect(new Set(enrolledYaml.memberPkIds).size).toBe(2)
  })

  test('device B unlocks and reads genesis secret', async () => {
    await unlockGithubVault(deviceB, target)
    await assertVaultReady(deviceB)

    await waitForSecretOnDevice(deviceB, genesisSecretKey, target)
    const revealed = await revealSecretValue(deviceB, genesisSecretKey)
    expect(revealed).toBe(genesisSecretValue)
  })

  test('both devices can add secrets and see shared vault state', async () => {
    await addSecret(deviceB, joinerSecretKey, joinerSecretValue, target)

    const yaml = await waitForGithubVaultState(
      target,
      (snapshot) => snapshot.secretIds.length >= 2,
    )
    expect(yaml.secretIds).toHaveLength(2)

    await assertVaultReady(deviceA)
    await waitForSecretOnDevice(deviceA, joinerSecretKey, target)
    const revealed = await revealSecretValue(deviceA, joinerSecretKey)
    expect(revealed).toBe(joinerSecretValue)
  })

  test('settings shows storage, passwords, and devices separately from onboarding', async () => {
    await openStorageSettings(deviceA)
    await expect(deviceA.getByTestId('storage-providers-section')).toBeVisible()
    await expect(deviceA.getByTestId('vault-unlock-section')).toBeVisible()
    await expect(deviceA.getByTestId('vault-devices-section')).toBeVisible()
    await expandSettingsSection(deviceA, 'devices')
    await expect(deviceA.getByTestId('vault-members-list')).toBeVisible()
    await deviceA.getByTestId('vault-secrets-tab').click()
    await assertVaultReady(deviceA)
  })
})

test.describe(`multi-device approve from settings (${providerLabel} stub sync)`, () => {
  test.setTimeout(120_000)

  let deviceA: Page
  let deviceB: Page
  let contextA: BrowserContext
  let contextB: BrowserContext
  let target: SyncE2eTarget

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000)
    target = createSyncTarget('', 'multi-device-settings')

    contextA = await createIsolatedContext(browser)
    contextB = await createIsolatedContext(browser)
    deviceA = await contextA.newPage()
    deviceB = await contextB.newPage()
    await disableVaultIdleLock(deviceB)

    await installSyncStubOnPages([deviceA, deviceB], target)
    await connectSyncGenesisDevice(deviceA, target)
  })

  test.afterAll(async () => {
    await deviceA?.close()
    await deviceB?.close()
    await contextA?.close()
    await contextB?.close()
  })

  test('approves join from settings', async () => {
    await connectSyncJoinerDevice(deviceB, target)
    const join = await sendJoinRequest(
      deviceB,
      target.pat,
      target.repoName,
      target.stub,
    )

    await approveJoinFromSettings(deviceA, join.deviceId, target, 2)

    const enrolledYaml = await assertEnrolledVaultOnGithub(target, 2)
    const parsed = parseVaultYamlSnapshot(enrolledYaml.raw)
    expect(parsed.joinEntries).toHaveLength(0)
    expect(parsed.authPkIds).toHaveLength(2)
    expect(parsed.memberPkIds).toHaveLength(2)

    await unlockGithubVault(deviceB, target)
    await assertVaultReady(deviceB)
  })
})

test.describe(`multi-device join background sync (${providerLabel} stub sync)`, () => {
  test.setTimeout(120_000)

  let deviceA: Page
  let deviceB: Page
  let contextA: BrowserContext
  let contextB: BrowserContext
  let target: SyncE2eTarget

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000)
    target = createSyncTarget('', 'multi-device-bg')

    contextA = await createIsolatedContext(browser)
    contextB = await createIsolatedContext(browser)
    deviceA = await contextA.newPage()
    deviceB = await contextB.newPage()
    await disableVaultIdleLock(deviceB)

    await installSyncStubOnPages([deviceA, deviceB], target)
    await connectSyncGenesisDevice(deviceA, target)
  })

  test.afterAll(async () => {
    await deviceA?.close()
    await deviceB?.close()
    await contextA?.close()
    await contextB?.close()
  })

  test('device A eventually sees pending join without manual refresh', async () => {
    await connectSyncJoinerDevice(deviceB, target)
    const join = await sendJoinRequest(
      deviceB,
      target.pat,
      target.repoName,
      target.stub,
    )

    await waitForGithubVaultState(
      target,
      (snapshot) => snapshot.joinEntries.length === 1,
    )

    await expect(deviceA.getByTestId('pending-joins-banner')).toBeVisible({
      timeout: NOTIFICATION_TIMEOUT_MS,
    })
    await expect(
      deviceA.getByTestId('device-join-row').filter({ hasText: join.deviceId }),
    ).toBeVisible()
  })
})
