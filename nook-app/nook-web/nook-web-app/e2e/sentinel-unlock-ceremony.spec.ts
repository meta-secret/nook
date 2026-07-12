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

async function nameVaultAndContinue(page: Page, name: string) {
  await page.getByTestId('login-vault-name-input').fill(name)
  await page.getByTestId('landing-auth-name-continue').click()
  await expect(page.getByTestId('get-started-path-chooser')).toBeVisible()
}

test.describe('provider-free Sentinel unlock ceremony', () => {
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

  test('creates and delivers a 2-of-2 Sentinel without a sync provider', async () => {
    await nameVaultAndContinue(deviceA, 'Sentinel quorum')
    await deviceA.getByTestId('get-started-path-sentinel').click()
    await deviceA
      .getByTestId('sentinel-genesis-name-input')
      .fill('Sentinel quorum')
    await deviceA.getByTestId('sentinel-genesis-participant-count').fill('2')
    await deviceA.getByTestId('sentinel-genesis-threshold').fill('2')
    await deviceA.getByTestId('sentinel-genesis-start').click()

    const genesisRequest = deviceA.getByTestId(
      'sentinel-genesis-request-output',
    )
    await expect(genesisRequest).toBeVisible({ timeout: UI_TIMEOUT_MS })
    const requestPayload = await genesisRequest.inputValue()
    expect(requestPayload.length).toBeGreaterThan(20)

    await nameVaultAndContinue(deviceB, 'Join device')
    await deviceB.getByTestId('get-started-path-join').click()
    const responseOutput = deviceB.getByTestId(
      'sentinel-genesis-generated-response',
    )
    await expect(responseOutput).toBeVisible({ timeout: UI_TIMEOUT_MS })
    const participantResponse = await responseOutput.inputValue()
    expect(participantResponse).toContain('publicKeyAnnouncement')

    await deviceA
      .getByTestId('sentinel-genesis-response-input')
      .fill(participantResponse)
    await deviceA.getByTestId('sentinel-genesis-add-participant').click()
    await expect(
      deviceA.getByTestId('sentinel-genesis-progress'),
    ).toContainText('2 / 2')
    await expect(deviceA.getByTestId('sentinel-genesis-finalize')).toBeEnabled()
    await deviceA.getByTestId('sentinel-genesis-finalize').click()

    const participantDelivery = deviceA
      .getByTestId('sentinel-genesis-delivery')
      .nth(1)
    await expect(participantDelivery).toBeVisible({ timeout: UI_TIMEOUT_MS })
    const deliveryPayload = await participantDelivery
      .getByTestId('sentinel-genesis-delivery-output')
      .inputValue()
    expect(deliveryPayload.length).toBeGreaterThan(20)

    await deviceB
      .getByTestId('sentinel-genesis-share-request-input')
      .fill(requestPayload)
    await deviceB
      .getByTestId('sentinel-genesis-receive-share-input')
      .fill(deliveryPayload)
    await deviceB.getByTestId('sentinel-genesis-receive-share').click()
    await expect(
      deviceB.getByText(/protected locally|сохранена локально/i),
    ).toBeVisible()

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

    await deviceB.reload()
    const helper = deviceB.getByTestId('sentinel-unlock-participant-helper')
    await expect(helper).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
    await expect(
      deviceB.getByTestId('sentinel-unlock-delivery-select'),
    ).toBeVisible()
    await deviceB
      .getByTestId('sentinel-unlock-participant-request-input')
      .fill(unlockRequest)
    await deviceB.getByTestId('sentinel-unlock-create-response-btn').click()
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

    await flushNookLogPersistQueue(deviceA)
    const logs = JSON.stringify(await readPersistedAppLogs(deviceA, 1000))
    expect(logs).not.toContain(opaqueResponse)
  })
})
