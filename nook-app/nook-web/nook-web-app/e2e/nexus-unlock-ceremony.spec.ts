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
  await page.goto('/')
  await clearBrowserVault(page)
  await page.reload()
  await expect(page.getByTestId('login-create-vault-chooser')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
}

test.describe('provider-free Nexus unlock ceremony', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(180_000)

  let deviceA: Page
  let deviceB: Page
  let contextA: BrowserContext
  let contextB: BrowserContext

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

  test('creates and delivers a 2-of-2 Nexus without a sync provider', async () => {
    await deviceA.getByTestId('vault-mode-select').click()
    await deviceA.getByTestId('mode-option-nexus').click()
    await deviceA.getByTestId('create-vault-wizard-continue').click()
    await deviceA.getByTestId('nexus-genesis-name-input').fill('Nexus quorum')
    await deviceA.getByTestId('nexus-genesis-participant-count').fill('2')
    await deviceA.getByTestId('nexus-genesis-threshold').fill('2')
    await deviceA.getByTestId('nexus-genesis-start').click()

    const genesisRequest = deviceA.getByTestId('nexus-genesis-request-output')
    await expect(genesisRequest).toBeVisible({ timeout: UI_TIMEOUT_MS })
    const requestPayload = await genesisRequest.inputValue()
    expect(requestPayload.length).toBeGreaterThan(20)

    await deviceB.getByTestId('nexus-genesis-join-toggle').click()
    await deviceB
      .getByTestId('nexus-genesis-join-request-input')
      .fill(requestPayload)
    await deviceB.getByTestId('nexus-genesis-create-response').click()
    const responseOutput = deviceB.getByTestId(
      'nexus-genesis-generated-response',
    )
    await expect(responseOutput).toBeVisible({ timeout: UI_TIMEOUT_MS })
    const participantResponse = await responseOutput.inputValue()
    const fingerprintText =
      (await deviceB
        .getByTestId('nexus-genesis-generated-fingerprint')
        .textContent()) ?? ''
    const fingerprint = fingerprintText.split(':').at(-1)?.trim() ?? ''
    expect(fingerprint.length).toBeGreaterThan(5)

    await deviceA
      .getByTestId('nexus-genesis-response-input')
      .fill(participantResponse)
    await deviceA.getByTestId('nexus-genesis-add-participant').click()
    await expect(deviceA.getByTestId('nexus-genesis-progress')).toContainText(
      '2 / 2',
    )
    await expect(deviceA.getByTestId('nexus-genesis-finalize')).toBeEnabled()
    await deviceA.getByTestId('nexus-genesis-finalize').click()

    const participantDelivery = deviceA
      .getByTestId('nexus-genesis-delivery')
      .filter({ hasText: fingerprint })
    await expect(participantDelivery).toBeVisible({ timeout: UI_TIMEOUT_MS })
    const deliveryPayload = await participantDelivery
      .getByTestId('nexus-genesis-delivery-output')
      .inputValue()
    expect(deliveryPayload.length).toBeGreaterThan(20)

    await deviceB
      .getByTestId('nexus-genesis-receive-share-input')
      .fill(deliveryPayload)
    await deviceB.getByTestId('nexus-genesis-receive-share').click()
    await expect(
      deviceB.getByText(/protected locally|сохранена локально/i),
    ).toBeVisible()

    await deviceA.getByTestId('nexus-genesis-delivery-complete').click()
    await expect(deviceA.getByTestId('nexus-ceremony-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
  })

  test('exchanges only opaque session-bound responses and reaches quorum', async () => {
    await deviceA.getByTestId('nexus-unlock-start-btn').click()
    const unlockRequestOutput = deviceA.getByTestId(
      'nexus-unlock-request-output',
    )
    await expect(unlockRequestOutput).toBeVisible({ timeout: UI_TIMEOUT_MS })
    const unlockRequest = await unlockRequestOutput.inputValue()
    expect(unlockRequest).not.toContain('mnemonic')
    expect(unlockRequest).not.toContain('share_mnemonic')
    await expect(deviceA.getByTestId('nexus-unlock-progress')).toContainText(
      '1/2',
    )
    await expect(
      deviceA.getByTestId('nexus-unlock-finalize-btn'),
    ).toBeDisabled()

    await deviceB.reload()
    const helper = deviceB.getByTestId('nexus-unlock-participant-helper')
    await expect(helper).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
    await expect(
      deviceB.getByTestId('nexus-unlock-delivery-select'),
    ).toBeVisible()
    await deviceB
      .getByTestId('nexus-unlock-participant-request-input')
      .fill(unlockRequest)
    await deviceB.getByTestId('nexus-unlock-create-response-btn').click()
    const opaqueResponseOutput = deviceB.getByTestId(
      'nexus-unlock-generated-response-output',
    )
    await expect(opaqueResponseOutput).toBeVisible({ timeout: UI_TIMEOUT_MS })
    const opaqueResponse = await opaqueResponseOutput.inputValue()
    expect(opaqueResponse.length).toBeGreaterThan(20)
    expect(opaqueResponse).not.toContain('mnemonic')
    expect(opaqueResponse).not.toContain('share_mnemonic')

    await deviceA
      .getByTestId('nexus-unlock-response-input')
      .fill(opaqueResponse)
    await deviceA.getByTestId('nexus-unlock-add-response-btn').click()
    await expect(deviceA.getByTestId('nexus-unlock-progress')).toContainText(
      '2/2',
    )
    await expect(deviceA.getByTestId('nexus-unlock-finalize-btn')).toBeEnabled()
    await deviceA.getByTestId('nexus-unlock-finalize-btn').click()
    await expect(deviceA.getByTestId('vault-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })

    await flushNookLogPersistQueue(deviceA)
    const logs = JSON.stringify(await readPersistedAppLogs(deviceA, 1000))
    expect(logs).not.toContain(opaqueResponse)
  })
})
