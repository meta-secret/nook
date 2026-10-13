import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from './fixtures'
import {
  addSecret,
  approveIdentityJoin,
  assertVaultReady,
  createIsolatedContext,
  disableVaultIdleLock,
  expandSettingsSection,
  openStorageSettings,
  issueIdentityEnrollmentCode,
  localizeAppLinkForE2e,
  openVaultAfterIdentityApproval,
  redeemIdentityEnrollmentCode,
  revealSecretValue,
  triggerVaultSyncRefresh,
  uniqueSecretKey,
  UI_TIMEOUT_MS,
  NOTIFICATION_TIMEOUT_MS,
  waitForGithubVaultState,
  waitForSecretOnDevice,
  waitForVaultOperationsIdle,
  openVaultPage,
  openManagePage,
  ManagePage,
  type IssuedIdentityCode,
} from './helpers'
import { assertGenesisVaultYaml } from './vault-yaml'
import {
  createSyncTarget,
  installSyncRemoteOnPages,
  connectSyncGenesisDevice,
  e2eSyncProviderDef,
  resolveE2eSyncProvider,
  waitForSyncRemoteState,
  type SyncE2eTarget,
} from './sync-provider'

const providerLabel = e2eSyncProviderDef(resolveE2eSyncProvider()).label

// One worker per file — nested describes share the same remote timing and must not overlap.
test.describe.configure({ mode: 'serial' })

async function createMultiDevicePair(browser: Browser, targetName: string) {
  const target = createSyncTarget('', targetName)
  const contextA = await createIsolatedContext(browser)
  const contextB = await createIsolatedContext(browser)
  const deviceA = await contextA.newPage()
  const deviceB = await contextB.newPage()
  await disableVaultIdleLock(deviceB)
  await installSyncRemoteOnPages([deviceA, deviceB], target)
  await connectSyncGenesisDevice(deviceA, target)
  await disableVaultIdleLock(deviceA)
  return { contextA, contextB, deviceA, deviceB, target }
}

test.describe(`multi-device ${providerLabel} vault`, () => {
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
  let issued: IssuedIdentityCode

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000)
    target = createSyncTarget('', 'multi-device')

    contextA = await createIsolatedContext(browser)
    contextB = await createIsolatedContext(browser)
    deviceA = await contextA.newPage()
    deviceB = await contextB.newPage()
    await disableVaultIdleLock(deviceB)

    await installSyncRemoteOnPages([deviceA, deviceB], target)
    await connectSyncGenesisDevice(deviceA, target)
    await disableVaultIdleLock(deviceA)
    await disableVaultIdleLock(deviceA)
    await waitForVaultOperationsIdle(deviceA)
    await addSecret(deviceA, genesisSecretKey, genesisSecretValue, target)

    const genesisYaml = await waitForSyncRemoteState(
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

  test('device B redeems an identity code and waits for approval', async () => {
    issued = await issueIdentityEnrollmentCode(deviceA)
    await deviceB.goto(localizeAppLinkForE2e(deviceA, issued.link))
    await expect(deviceB.getByTestId('login-gate')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await redeemIdentityEnrollmentCode(deviceB, issued.passphrase)
  })

  test('device A approves the identity join from Devices', async () => {
    await approveIdentityJoin(deviceA, 2)
    await openVaultPage(deviceA)
  })

  test('device B opens the vault and reads the genesis secret', async () => {
    await openVaultAfterIdentityApproval(deviceB)
    await assertVaultReady(deviceB)

    await waitForSecretOnDevice(deviceB, genesisSecretKey, target)
    const revealed = await revealSecretValue(deviceB, genesisSecretKey)
    expect(revealed).toBe(genesisSecretValue)

    // Opening the vault self-enrolls B with the DEK its identity granted.
    const enrolledYaml = await waitForGithubVaultState(
      target,
      (snapshot) => snapshot.authPkIds.length >= 2,
    )
    expect(enrolledYaml.secretIds).toHaveLength(1)
    expect(new Set(enrolledYaml.authPkIds).size).toBe(2)
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

  test('management keeps sync, backup passwords, and devices on their own pages', async () => {
    await openStorageSettings(deviceA)
    await expect(deviceA.getByTestId('storage-providers-section')).toBeVisible()
    await openManagePage(deviceA, ManagePage.Passwords)
    await expect(deviceA.getByTestId('vault-unlock-section')).toBeVisible()
    await expect(deviceA.getByTestId('storage-providers-section')).toHaveCount(
      0,
    )
    await openManagePage(deviceA, ManagePage.Devices)
    await expect(deviceA.getByTestId('vault-devices-section')).toBeVisible()
    await expandSettingsSection(deviceA, 'devices')
    await expect(deviceA.getByTestId('vault-members-list')).toBeVisible()
    await openVaultPage(deviceA)
    await assertVaultReady(deviceA)
  })
})

test.describe(`multi-device approve from the vault page (${providerLabel})`, () => {
  test.setTimeout(120_000)

  let deviceA: Page
  let deviceB: Page
  let contextA: BrowserContext
  let contextB: BrowserContext

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000)
    ;({ contextA, contextB, deviceA, deviceB } = await createMultiDevicePair(
      browser,
      'multi-device-banner',
    ))
  })

  test.afterAll(async () => {
    await deviceA?.close()
    await deviceB?.close()
    await contextA?.close()
    await contextB?.close()
  })

  test('approves an identity join from the pending joins banner', async () => {
    const issued = await issueIdentityEnrollmentCode(deviceA)
    await deviceB.goto(localizeAppLinkForE2e(deviceA, issued.link))
    await redeemIdentityEnrollmentCode(deviceB, issued.passphrase)

    await openVaultPage(deviceA)
    const row = deviceA.getByTestId('device-join-row').first()
    await expect
      .poll(
        async () => {
          if (await row.isVisible()) return true
          await triggerVaultSyncRefresh(deviceA)
          await waitForVaultOperationsIdle(deviceA)
          return row.isVisible()
        },
        { timeout: NOTIFICATION_TIMEOUT_MS },
      )
      .toBe(true)
    await row.getByTestId('approve-join-btn').click()
    await expect(row).not.toBeVisible({ timeout: UI_TIMEOUT_MS })

    await openVaultAfterIdentityApproval(deviceB)
    await assertVaultReady(deviceB)
  })
})

test.describe(`multi-device join background sync (${providerLabel})`, () => {
  test.setTimeout(120_000)

  let deviceA: Page
  let deviceB: Page
  let contextA: BrowserContext
  let contextB: BrowserContext

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000)
    ;({ contextA, contextB, deviceA, deviceB } = await createMultiDevicePair(
      browser,
      'multi-device-bg',
    ))
  })

  test.afterAll(async () => {
    await deviceA?.close()
    await deviceB?.close()
    await contextA?.close()
    await contextB?.close()
  })

  test('device A picks up a pending identity join while it refreshes', async () => {
    const issued = await issueIdentityEnrollmentCode(deviceA)
    await openVaultPage(deviceA)
    await deviceB.goto(localizeAppLinkForE2e(deviceA, issued.link))
    await redeemIdentityEnrollmentCode(deviceB, issued.passphrase)

    await expect
      .poll(
        async () => {
          if (await deviceA.getByTestId('pending-joins-banner').isVisible()) {
            return true
          }
          await deviceA.evaluate(async () => {
            const vault = window.__nookVault
            await vault?.refreshPendingJoinsFromProviders?.()
          })
          return deviceA.getByTestId('pending-joins-banner').isVisible()
        },
        { timeout: NOTIFICATION_TIMEOUT_MS },
      )
      .toBe(true)
    await expect(deviceA.getByTestId('device-join-row')).toHaveCount(1)
  })
})
