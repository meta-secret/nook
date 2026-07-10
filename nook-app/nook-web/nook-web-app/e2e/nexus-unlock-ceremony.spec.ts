import { test, expect, type BrowserContext, type Page } from './fixtures'
import {
  approveJoinLocalE2eFromBanner,
  assertVaultReady,
  authorizeDeviceProtection,
  connectLocalE2eJoinerDevice,
  createIsolatedContext,
  createLocalVaultOnLogin,
  disableLoginAutoUnlock,
  disableVaultIdleLock,
  E2E_OAUTH_ONBOARD_PROVIDER,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  flushNookLogPersistQueue,
  readPersistedAppLogs,
  forceVaultQuiescentForE2e,
  seedOauthFileSyncProvidersWhileUnlocked,
  sendJoinRequestLocalE2e,
  triggerVaultSyncRefresh,
  UI_TIMEOUT_MS,
  waitForLoadedSyncProviders,
  waitForSyncRemoteVaultState,
  waitForVaultOperationsIdle,
  waitForVaultSyncIdle,
} from './helpers'
import { createLocalE2eFileSyncVaultStub } from './file-sync-stub'

const NEXUS_PROVIDER = {
  ...E2E_OAUTH_ONBOARD_PROVIDER,
  id: 'nexus-ceremony-provider',
  label: 'Nexus ceremony sync',
  fileName: 'nexus-ceremony-events.yaml',
}

async function openLocalShareContribution(page: Page): Promise<string> {
  await expect(page.getByTestId('nexus-ceremony-panel')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await page.getByTestId('nexus-open-local-share-btn').click()
  const output = page.getByTestId('nexus-local-share-output')
  await expect(output).toBeVisible({ timeout: UI_TIMEOUT_MS })
  await expect
    .poll(async () => (await output.inputValue()).trim().length, {
      timeout: UI_TIMEOUT_MS,
    })
    .toBeGreaterThan(10)
  const value = (await output.inputValue()).trim()
  expect(value).toContain('"share"')
  return value
}

async function lockVault(page: Page) {
  await page.getByTestId('header-lock-vault-btn').click()
  await authorizeDeviceProtection(page)
  await expect(page.getByTestId('login-gate')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
}

async function waitForCeremonyPanel(page: Page) {
  await expect(page.getByTestId('nexus-ceremony-panel')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect(page.getByTestId('login-unlock-method-password')).toHaveCount(0)
}

test.describe('nexus unlock ceremony', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(180_000)

  let deviceA: Page
  let deviceB: Page
  let contextA: BrowserContext
  let contextB: BrowserContext
  let stub: ReturnType<typeof createLocalE2eFileSyncVaultStub>
  let shareA = ''
  let shareB = ''

  test.beforeAll(async ({ browser }) => {
    contextA = await createIsolatedContext(browser)
    contextB = await createIsolatedContext(browser)
    deviceA = await contextA.newPage()
    deviceB = await contextB.newPage()
    await disableVaultIdleLock(deviceB)

    await deviceA.goto('/')
    await expect(deviceA.getByTestId('login-create-vault-chooser')).toBeVisible(
      {
        timeout: UI_TIMEOUT_MS,
      },
    )
    await deviceA.getByTestId('vault-mode-select').click()
    await deviceA.getByTestId('mode-option-nexus').click()
    await expect(deviceA.getByTestId('nexus-readiness-gate')).toBeVisible()
    await createLocalVaultOnLogin(deviceA, 'Nexus ceremony vault')
    await assertVaultReady(deviceA)
    await expect(deviceA.getByTestId('add-secret-btn')).toBeDisabled()

    stub = createLocalE2eFileSyncVaultStub('', NEXUS_PROVIDER.fileName)
    await stub.install(deviceA, {
      fileName: NEXUS_PROVIDER.fileName,
      vaultYaml: '',
    })
    await stub.install(deviceB, {
      fileName: NEXUS_PROVIDER.fileName,
      vaultYaml: '',
    })

    // Keep genesis unlocked: nexus cannot reconnect via device-key envelopes.
    await seedOauthFileSyncProvidersWhileUnlocked(
      deviceA,
      [NEXUS_PROVIDER],
      stub,
    )
    await waitForLoadedSyncProviders(deviceA)
    await forceVaultQuiescentForE2e(deviceA)
    await deviceA.evaluate(async () => {
      const vault = (
        window as Window & {
          __nookVault?: {
            runFanOutSyncAfterLocalSave?: () => Promise<void>
          }
        }
      ).__nookVault
      await vault?.runFanOutSyncAfterLocalSave?.()
    })
    await waitForVaultOperationsIdle(deviceA)
    await waitForVaultSyncIdle(deviceA)
    // Nexus genesis has no auth envelopes; wait for any event-log fan-out.
    await expect
      .poll(() => stub.getEventFileCount(), {
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })
      .toBeGreaterThan(0)
  })

  test.afterAll(async () => {
    await deviceA?.close()
    await deviceB?.close()
    await contextA?.close()
    await contextB?.close()
  })

  test('enrolls a second device and issues nexus shares', async () => {
    await connectLocalE2eJoinerDevice(deviceB, NEXUS_PROVIDER.fileName)
    const join = await sendJoinRequestLocalE2e(deviceB, stub)

    await triggerVaultSyncRefresh(deviceA)
    await approveJoinLocalE2eFromBanner(deviceA, join.deviceId, stub, 2)

    await waitForSyncRemoteVaultState(
      stub,
      (snapshot) =>
        snapshot.memberPkIds.length >= 2 && snapshot.nexusShareCount >= 2,
    )
  })

  test('both devices open local shares and device A unlocks via ceremony', async () => {
    await disableLoginAutoUnlock(deviceA)
    await lockVault(deviceA)
    await waitForCeremonyPanel(deviceA)

    shareA = await openLocalShareContribution(deviceA)

    // Device B may not have a local unlock step yet — open share via evaluate.
    shareB = await deviceB.evaluate(async () => {
      const vault = (
        window as Window & {
          __nookVault?: {
            syncFromStorage?: (opts?: { force?: boolean }) => Promise<void>
            loadDb?: () => Promise<void>
            openLocalNexusShare?: () => Promise<string>
            ensureNexusCeremonyHydrated?: () => Promise<void>
            manager?: { openLocalNexusShare?: () => string }
            enqueueStorage?: <T>(op: () => T | Promise<T>) => Promise<T>
          }
        }
      ).__nookVault
      await vault?.syncFromStorage?.({ force: true })
      try {
        await vault?.loadDb?.()
      } catch {
        // Ceremony-required is expected for nexus without shares combined.
      }
      if (vault?.openLocalNexusShare) {
        return vault.openLocalNexusShare()
      }
      if (!vault?.enqueueStorage || !vault.manager?.openLocalNexusShare) {
        throw new Error('openLocalNexusShare unavailable on device B')
      }
      return vault.enqueueStorage(() => vault.manager!.openLocalNexusShare!())
    })
    expect(shareB).toContain('"share"')

    await deviceA.evaluate((peerShare) => {
      const vault = (
        window as Window & {
          __nookVault?: { nexusPeerShareContributions?: string }
        }
      ).__nookVault
      if (vault) vault.nexusPeerShareContributions = peerShare
    }, shareB)

    await expect(deviceA.getByTestId('nexus-peer-shares-input')).toHaveValue(
      shareB,
    )
    await deviceA.getByTestId('nexus-ceremony-unlock-btn').click()
    await assertVaultReady(deviceA)
    await expect(deviceA.getByTestId('vault-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })

    await flushNookLogPersistQueue(deviceA)
    const logs = await readPersistedAppLogs(deviceA, 1000)
    const serialized = JSON.stringify(logs ?? [])
    expect(serialized).not.toContain(shareA)
    expect(serialized).not.toContain(shareB)
  })

  test('password unlock stays forbidden for nexus', async () => {
    await disableLoginAutoUnlock(deviceA)
    await lockVault(deviceA)
    await waitForCeremonyPanel(deviceA)

    const passwordResult = await deviceA.evaluate(async () => {
      const vault = (
        window as Window & {
          __nookVault?: {
            unlockWithPassword?: (
              entryId: string,
              password: string,
            ) => Promise<void>
            errorMsg?: string
            isAuthenticated?: boolean
          }
        }
      ).__nookVault
      if (!vault?.unlockWithPassword) {
        return { ok: false, error: 'missing unlockWithPassword' }
      }
      await vault.unlockWithPassword('missing-entry', 'not-a-real-password')
      return {
        ok: true,
        authenticated: Boolean(vault.isAuthenticated),
        error: vault.errorMsg ?? '',
      }
    })

    expect(passwordResult.ok).toBe(true)
    expect(passwordResult.authenticated).toBe(false)
    expect(passwordResult.error).toMatch(/password unlock is forbidden|nexus/i)
  })
})
