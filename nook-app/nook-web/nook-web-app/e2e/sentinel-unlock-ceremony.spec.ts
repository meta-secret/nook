import { test, expect, type BrowserContext, type Page } from './fixtures'
import {
  clearBrowserVault,
  createIsolatedContext,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  flushNookLogPersistQueue,
  readPersistedAppLogs,
  UI_TIMEOUT_MS,
} from './helpers'

async function openFreshDevice(
  page: Page,
  options?: { manualPasskey?: boolean },
) {
  await page.goto('/app/')
  await clearBrowserVault(page)
  if (options?.manualPasskey) {
    await page.evaluate(() => {
      localStorage.setItem('nook_e2e_manual_passkey', 'true')
    })
  }
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
  let deviceC: Page
  let contextA: BrowserContext
  let contextB: BrowserContext
  let contextC: BrowserContext
  let memberStoreId = ''

  test.beforeAll(async ({ browser }) => {
    contextA = await createIsolatedContext(browser)
    contextB = await createIsolatedContext(browser)
    contextC = await createIsolatedContext(browser)
    deviceA = await contextA.newPage()
    deviceB = await contextB.newPage()
    deviceC = await contextC.newPage()
    await openFreshDevice(deviceA)
    await openFreshDevice(deviceB, { manualPasskey: true })
    await openFreshDevice(deviceC, { manualPasskey: true })
  })

  test.afterAll(async () => {
    await deviceA?.close()
    await deviceB?.close()
    await deviceC?.close()
    await contextA?.close()
    await contextB?.close()
    await contextC?.close()
  })

  test('completes local 2-of-3 Sentinel onboarding and unlock through the browser UI', async () => {
    await expectPathChooser(deviceA)
    await deviceA.getByTestId('get-started-path-sentinel').click()
    await deviceA.getByTestId('sentinel-dashboard-card-stack').click()
    await deviceA.getByTestId('sentinel-onboarding-create-keys').click()
    const passkeyOverlay = deviceA.getByTestId('passkey-auth-overlay')
    const nameStep = deviceA.getByTestId('sentinel-genesis-name-step')
    const policyStep = deviceA.getByTestId('sentinel-genesis-policy-step')
    await expect
      .poll(
        async () =>
          (await passkeyOverlay.isVisible()) || (await nameStep.isVisible()),
        { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
      )
      .toBe(true)
    if (await passkeyOverlay.isVisible()) {
      await deviceA
        .getByTestId('device-protection-create-new-choice')
        .click({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
      const setupBtn = deviceA.getByTestId('device-protection-setup-btn')
      await expect(setupBtn).toBeEnabled({
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })
      await setupBtn.click({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
    }
    await expect(nameStep).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await deviceA
      .getByTestId('sentinel-genesis-name-input')
      .fill('Sentinel quorum')
    await deviceA.getByTestId('sentinel-onboarding-continue-policy').click()
    await expect(policyStep).toBeVisible()
    await deviceA.getByTestId('sentinel-genesis-participant-count').click()
    await deviceA.getByTestId('sentinel-participant-count-option-3').click()
    await deviceA.getByTestId('sentinel-onboarding-continue-devices').click()
    await expect(
      deviceA.getByTestId('sentinel-genesis-participant-fields'),
    ).toBeVisible()

    const genesisRequest = deviceA.getByTestId(
      'sentinel-genesis-request-output',
    )
    await expect(genesisRequest).toBeVisible({ timeout: UI_TIMEOUT_MS })
    const invitationLink = await genesisRequest.inputValue()
    expect(invitationLink).toContain('#sentinel-request=')

    async function connectParticipant(participantDevice: Page) {
      await participantDevice.goto(invitationLink)
      await expect(
        participantDevice.getByTestId('sentinel-genesis-participant-step'),
      ).toBeVisible({ timeout: UI_TIMEOUT_MS })
      await expect(
        participantDevice.getByTestId('sentinel-genesis-connect-device'),
      ).toBeVisible()
      await participantDevice
        .getByTestId('sentinel-genesis-connect-device')
        .click()
      const participantPasskeyOverlay = participantDevice.getByTestId(
        'passkey-auth-overlay',
      )
      await expect(participantPasskeyOverlay).toBeVisible({
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })
      await participantDevice
        .getByTestId('device-protection-create-new-choice')
        .click({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
      const participantSetupButton = participantDevice.getByTestId(
        'device-protection-setup-btn',
      )
      await expect(participantSetupButton).toBeEnabled({
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })
      await participantSetupButton.click({
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })
      const participantResponseOutput = participantDevice.getByTestId(
        'sentinel-genesis-generated-response',
      )
      await expect(participantResponseOutput).toBeVisible({
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })
      const responseLink = await participantResponseOutput.inputValue()
      expect(responseLink).toContain('#sentinel-response=')
      return responseLink
    }

    async function addParticipant(
      participantDevice: Page,
      participantName: string,
    ) {
      await deviceA.goto(await connectParticipant(participantDevice))
      await expect(
        deviceA.getByTestId('sentinel-genesis-authentication-ready'),
      ).toBeVisible({ timeout: UI_TIMEOUT_MS })
      await deviceA
        .getByTestId('sentinel-genesis-participant-name')
        .fill(participantName)
      await deviceA.getByTestId('sentinel-genesis-add-participant').click()
    }

    await addParticipant(deviceB, 'Member device B')
    await addParticipant(deviceC, 'Member device C')
    await expect(
      deviceA.getByTestId('sentinel-genesis-participant-count'),
    ).toHaveCount(0)
    await expect(deviceA.getByTestId('sentinel-genesis-finalize')).toBeEnabled()
    await deviceA.getByTestId('sentinel-genesis-finalize').click()

    expect((await genesisRequest.inputValue()).length).toBeGreaterThan(20)

    await expect(
      deviceA.getByTestId('sentinel-choose-sync-provider'),
    ).toHaveCount(0)
    await expect(
      deviceA.getByTestId('sentinel-onboarding-delivery-actions'),
    ).toContainText('Empty Sentinel vault created')
    await expect(deviceA.getByText('Choose where the vault syncs')).toHaveCount(
      0,
    )

    const participantDeliveries = deviceA.getByTestId(
      'sentinel-genesis-delivery',
    )
    await expect(participantDeliveries).toHaveCount(2, {
      timeout: UI_TIMEOUT_MS,
    })
    const deviceBDelivery = await participantDeliveries
      .nth(0)
      .getByTestId('sentinel-genesis-delivery-output')
      .inputValue()
    const deviceCDelivery = await participantDeliveries
      .nth(1)
      .getByTestId('sentinel-genesis-delivery-output')
      .inputValue()
    const parsedDelivery = JSON.parse(deviceBDelivery) as { storeId: string }
    memberStoreId = parsedDelivery.storeId
    expect(memberStoreId.length).toBeGreaterThan(0)
    expect(deviceBDelivery).not.toContain('githubPat')
    expect(deviceBDelivery).not.toContain('oauthFile')
    expect(deviceCDelivery).not.toContain('githubPat')
    expect(deviceCDelivery).not.toContain('oauthFile')

    async function receiveParticipantShare(
      participantDevice: Page,
      delivery: string,
    ) {
      const deliveryInput = participantDevice.getByTestId(
        'sentinel-genesis-receive-share-input',
      )
      await expect(deliveryInput).toBeVisible()
      await deliveryInput.fill(delivery)
      const receiveButton = participantDevice.getByTestId(
        'sentinel-genesis-receive-share',
      )
      await expect(receiveButton).toBeEnabled()
      await receiveButton.click()
      await expect(deliveryInput).toHaveValue('')
      await expect(
        participantDevice.getByTestId('sentinel-unlock-participant-helper'),
      ).toBeVisible({ timeout: UI_TIMEOUT_MS })
    }

    await receiveParticipantShare(deviceB, deviceBDelivery)
    await receiveParticipantShare(deviceC, deviceCDelivery)

    const ownerProviderCount = await deviceA.evaluate(() => {
      return (window as Window & { __nookVault?: { syncProviders: unknown[] } })
        .__nookVault?.syncProviders.length
    })
    expect(ownerProviderCount).toBe(0)

    const continueToUnlock = deviceA.getByTestId(
      'sentinel-genesis-delivery-complete',
    )
    await expect(continueToUnlock).toBeDisabled()
    await deviceA
      .getByTestId('sentinel-genesis-delivery-acknowledgement')
      .check()
    await expect(continueToUnlock).toBeEnabled()
    await continueToUnlock.click()
    await expect(deviceA.getByTestId('sentinel-ceremony-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
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

    const deliverySelect = deviceB.getByTestId(
      'sentinel-unlock-delivery-select',
    )
    await deviceB
      .getByTestId('sentinel-unlock-participant-request-input')
      .fill(unlockRequest)
    const createUnlockResponse = deviceB.getByTestId(
      'sentinel-unlock-create-response-btn',
    )
    await expect(createUnlockResponse).toBeDisabled()
    await deliverySelect.click()
    await deviceB
      .getByTestId(`sentinel-unlock-delivery-${memberStoreId}`)
      .click()
    await expect(deliverySelect).toContainText(memberStoreId)
    await expect(createUnlockResponse).toBeEnabled()
    await createUnlockResponse.click()
    const opaqueResponseOutput = deviceB.getByTestId(
      'sentinel-unlock-generated-response-output',
    )
    await expect(opaqueResponseOutput).toBeVisible({ timeout: UI_TIMEOUT_MS })
    const opaqueResponse = await opaqueResponseOutput.inputValue()
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
    await expect(deviceA.getByTestId('secret-row')).toHaveCount(0)
    const providerCountAfterUnlock = await deviceA.evaluate(() => {
      return (window as Window & { __nookVault?: { syncProviders: unknown[] } })
        .__nookVault?.syncProviders.length
    })
    expect(providerCountAfterUnlock).toBe(0)

    await flushNookLogPersistQueue(deviceA)
    const logs = JSON.stringify(await readPersistedAppLogs(deviceA, 1000))
    expect(logs).not.toContain(opaqueResponse)
  })
})
