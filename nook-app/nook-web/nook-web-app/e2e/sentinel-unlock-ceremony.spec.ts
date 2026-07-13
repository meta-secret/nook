import { test, expect, type BrowserContext, type Page } from './fixtures'
import {
  clearBrowserVault,
  createIsolatedContext,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  flushNookLogPersistQueue,
  readPersistedAppLogs,
  UI_TIMEOUT_MS,
} from './helpers'

async function openFreshDevice(page: Page) {
  await page.goto('/app/')
  await clearBrowserVault(page)
  await page.reload()
  await expect(page.getByTestId('login-create-vault-chooser')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
}

async function expectPathChooser(page: Page) {
  await expect(page.getByTestId('get-started-path-chooser')).toBeVisible()
}

test.describe('Sentinel member onboarding and unlock ceremony', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(180_000)

  let deviceA: Page
  let deviceB: Page
  let contextA: BrowserContext
  let contextB: BrowserContext
  let memberStoreId = ''

  test.beforeAll(async ({ browser }) => {
    contextA = await createIsolatedContext(browser)
    contextB = await createIsolatedContext(browser)
    deviceA = await contextA.newPage()
    deviceB = await contextB.newPage()
    await openFreshDevice(deviceA)
    await openFreshDevice(deviceB)
  })

  test.afterAll(async () => {
    await deviceA?.close()
    await deviceB?.close()
    await contextA?.close()
    await contextB?.close()
  })

  test('creates a 2-of-2 Sentinel and issues a provider-backed member invitation', async () => {
    await expectPathChooser(deviceB)
    const participantAnnouncement = await deviceB.evaluate(async () => {
      const participantVault = (
        window as Window & {
          __nookVault?: {
            setupDeviceProtection: (
              label: string,
              mode: 'standard',
            ) => Promise<void>
            createSentinelGenesisPublicKeyAnnouncement: () => Promise<string>
          }
        }
      ).__nookVault
      if (!participantVault) throw new Error('Participant vault is unavailable')
      await participantVault.setupDeviceProtection(
        'Sentinel participant',
        'standard',
      )
      return participantVault.createSentinelGenesisPublicKeyAnnouncement()
    })
    expect(participantAnnouncement).toContain('publicKeyAnnouncement')

    await expectPathChooser(deviceA)
    await deviceA.getByTestId('get-started-path-sentinel').click()
    await deviceA.getByTestId('sentinel-dashboard-card-stack').click()
    await deviceA.getByTestId('sentinel-onboarding-create-keys').click()
    const passkeyOverlay = deviceA.getByTestId('passkey-auth-overlay')
    const policyStep = deviceA.getByTestId('sentinel-genesis-policy-step')
    const responseInput = deviceA.getByTestId('sentinel-genesis-response-input')
    await expect
      .poll(
        async () =>
          (await passkeyOverlay.isVisible()) || (await policyStep.isVisible()),
        { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
      )
      .toBe(true)
    if (await passkeyOverlay.isVisible()) {
      const setupBtn = deviceA.getByTestId('device-protection-setup-btn')
      await expect(setupBtn).toBeEnabled({
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })
      await setupBtn.click({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
    }
    await expect(policyStep).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await deviceA
      .getByTestId('sentinel-genesis-name-input')
      .fill('Sentinel quorum')
    await deviceA.getByTestId('sentinel-genesis-participant-count').click()
    await deviceA.getByTestId('sentinel-participant-count-option-2').click()
    await deviceA.getByTestId('sentinel-onboarding-continue-devices').click()
    await expect(responseInput).toBeVisible()
    await deviceA
      .getByTestId('sentinel-genesis-response-input')
      .fill(participantAnnouncement)
    await deviceA.getByTestId('sentinel-genesis-add-participant').click()
    await expect(
      deviceA.getByTestId('sentinel-genesis-queued-participant'),
    ).toBeVisible()
    await expect(
      deviceA.getByTestId('sentinel-genesis-participant-count'),
    ).toHaveCount(0)
    await deviceA.getByTestId('sentinel-genesis-start').click()

    const genesisRequest = deviceA.getByTestId(
      'sentinel-genesis-request-output',
    )
    await expect(genesisRequest).toBeVisible({ timeout: UI_TIMEOUT_MS })
    const requestPayload = await genesisRequest.inputValue()
    expect(requestPayload.length).toBeGreaterThan(20)

    await expect(
      deviceA.getByTestId('sentinel-choose-sync-provider'),
    ).toBeVisible({ timeout: UI_TIMEOUT_MS })

    const providerToken = 'github_pat_sentinel_member_onboarding_secret'
    await deviceA.evaluate(async (token) => {
      const ownerVault = (
        window as Window & {
          __nookVault?: {
            activeVaultStoreId?: string
            providers: unknown[]
            prepareSentinelOnboardingLinks: () => Promise<void>
          }
        }
      ).__nookVault
      if (!ownerVault?.activeVaultStoreId)
        throw new Error('Finalized Sentinel store is unavailable')
      ownerVault.providers = [
        {
          id: 'sentinel-onboarding-provider',
          type: 'github',
          label: 'Sentinel onboarding GitHub',
          githubPat: token,
          githubRepo: 'sentinel-onboarding',
          storeId: ownerVault.activeVaultStoreId,
          createdAt: new Date().toISOString(),
        },
      ]
      await ownerVault.prepareSentinelOnboardingLinks()
    }, providerToken)

    const participantDelivery = deviceA
      .getByTestId('sentinel-genesis-delivery')
      .first()
    await expect(participantDelivery).toBeVisible({ timeout: UI_TIMEOUT_MS })
    const onboardingLink = await participantDelivery
      .getByTestId('sentinel-genesis-delivery-output')
      .inputValue()
    expect(onboardingLink).toContain('#sentinel-onboard=')
    expect(onboardingLink).not.toContain(providerToken)
    const onboardingPackage = new URL(onboardingLink).hash.replace(
      '#sentinel-onboard=',
      '',
    )
    expect(onboardingPackage).not.toContain(providerToken)

    await deviceB.goto(onboardingLink)
    await expect(deviceB.getByTestId('sentinel-accept-onboarding')).toBeVisible(
      {
        timeout: UI_TIMEOUT_MS,
      },
    )

    memberStoreId = await deviceB.evaluate(async (packageJson) => {
      const participantVault = (
        window as Window & {
          __nookVault?: {
            manager?: {
              acceptSentinelOnboardingPackage: (
                payload: string,
              ) => Promise<string>
            }
          }
        }
      ).__nookVault
      if (!participantVault?.manager)
        throw new Error('Participant vault is unavailable')
      return participantVault.manager.acceptSentinelOnboardingPackage(
        packageJson,
      )
    }, onboardingPackage)

    await deviceA.getByTestId('sentinel-genesis-delivery-complete').click()
    await expect(deviceA.getByTestId('sentinel-ceremony-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
  })

  test('exchanges only opaque session-bound responses and reaches quorum', async () => {
    await deviceA.getByTestId('sentinel-unlock-start-btn').click()
    const unlockRequestOutput = deviceA.getByTestId(
      'sentinel-unlock-request-output',
    )
    await expect(unlockRequestOutput).toBeVisible({ timeout: UI_TIMEOUT_MS })
    const unlockRequest = await unlockRequestOutput.inputValue()
    expect(unlockRequest).not.toContain('mnemonic')
    expect(unlockRequest).not.toContain('share_mnemonic')
    await expect(deviceA.getByTestId('sentinel-unlock-progress')).toContainText(
      '1/2',
    )
    await expect(
      deviceA.getByTestId('sentinel-unlock-finalize-btn'),
    ).toBeDisabled()

    const opaqueResponse = await deviceB.evaluate(
      async ({ storeId, request }) => {
        const participantVault = (
          window as Window & {
            __nookVault?: {
              manager?: {
                loadSentinelGenesisShareDelivery: (
                  storeId: string,
                ) => Promise<string>
                respondToSentinelUnlockRequest: (
                  request: string,
                ) => Promise<string>
              }
            }
          }
        ).__nookVault
        if (!participantVault?.manager)
          throw new Error('Participant vault is unavailable')
        await participantVault.manager.loadSentinelGenesisShareDelivery(storeId)
        return participantVault.manager.respondToSentinelUnlockRequest(request)
      },
      { storeId: memberStoreId, request: unlockRequest },
    )
    expect(opaqueResponse.length).toBeGreaterThan(20)
    expect(opaqueResponse).not.toContain('mnemonic')
    expect(opaqueResponse).not.toContain('share_mnemonic')

    await deviceA
      .getByTestId('sentinel-unlock-response-input')
      .fill(opaqueResponse)
    await deviceA.getByTestId('sentinel-unlock-add-response-btn').click()
    await expect(deviceA.getByTestId('sentinel-unlock-progress')).toContainText(
      '2/2',
    )
    await expect(
      deviceA.getByTestId('sentinel-unlock-finalize-btn'),
    ).toBeEnabled()
    await deviceA.getByTestId('sentinel-unlock-finalize-btn').click()
    await expect(deviceA.getByTestId('vault-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })

    await flushNookLogPersistQueue(deviceA)
    const logs = JSON.stringify(await readPersistedAppLogs(deviceA, 1000))
    expect(logs).not.toContain(opaqueResponse)
  })
})
