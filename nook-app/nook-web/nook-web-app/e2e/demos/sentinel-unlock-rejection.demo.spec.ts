import { expect, test, type Page } from '../fixtures'
import { createIsolatedContext, ENROLLMENT_UNLOCK_TIMEOUT_MS } from '../helpers'

const DEMO_BEAT_MS = 700

async function createDeviceProtection(page: Page): Promise<void> {
  await expect(page.getByTestId('passkey-auth-overlay')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await page.getByTestId('device-protection-create-new-choice').click()
  await page.getByTestId('device-protection-setup-btn').click()
}

test('a reset Sentinel ceremony replaces stale readiness after a rejected unlock', async ({
  browser,
  page,
}) => {
  test.setTimeout(180_000)
  await page.addInitScript(() => {
    localStorage.setItem('nook_e2e_manual_passkey', 'true')
  })
  await page.goto('/app/')
  await page.getByTestId('get-started-path-sentinel').click()
  await page.getByTestId('sentinel-dashboard-card-stack').click()
  await page.getByTestId('sentinel-onboarding-create-keys').click()
  await createDeviceProtection(page)
  await page.getByTestId('sentinel-genesis-name-input').fill('Quorum rejection')
  await page.getByTestId('sentinel-onboarding-continue-policy').click()
  await page.getByTestId('sentinel-genesis-participant-count').click()
  await page.getByTestId('sentinel-participant-count-option-3').click()
  await page.getByTestId('sentinel-onboarding-continue-devices').click()
  const invitation = page.getByTestId('sentinel-genesis-request-output')
  await expect(invitation).not.toHaveValue('')
  const invitationUrl = await invitation.inputValue()

  const participantContext = await createIsolatedContext(browser)
  const otherContext = await createIsolatedContext(browser)
  try {
    for (const context of [participantContext, otherContext]) {
      await context.addInitScript(() => {
        localStorage.setItem('nook_e2e_manual_passkey', 'true')
      })
    }
    const participants = [
      await participantContext.newPage(),
      await otherContext.newPage(),
    ] as const
    for (const [index, device] of participants.entries()) {
      await device.goto(invitationUrl)
      await device.getByTestId('sentinel-genesis-connect-device').click()
      await createDeviceProtection(device)
      const announcement = device.getByTestId(
        'sentinel-genesis-generated-response',
      )
      await expect(announcement).not.toHaveValue('', {
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })
      await page.goto(await announcement.inputValue())
      await page
        .getByTestId('sentinel-genesis-participant-name')
        .fill(`Member ${index + 1}`)
      await page.getByTestId('sentinel-genesis-add-participant').click()
    }
    await page.getByTestId('sentinel-genesis-finalize').click()

    const deliveryOutput = page.getByTestId('sentinel-genesis-delivery-output')
    await expect(deliveryOutput).toHaveCount(2)
    for (const [index, device] of participants.entries()) {
      const deliveryInput = device.getByTestId(
        'sentinel-genesis-receive-share-input',
      )
      await deliveryInput.fill(await deliveryOutput.nth(index).inputValue())
      await device.getByTestId('sentinel-genesis-receive-share').click()
      await expect(deliveryInput).toHaveValue('')
    }
    const participant = participants[0]
    const { storeId } = JSON.parse(
      await deliveryOutput.first().inputValue(),
    ) as { storeId: string }
    await page.getByTestId('sentinel-genesis-delivery-acknowledgement').check()
    await page.getByTestId('sentinel-genesis-delivery-complete').click()

    await page.getByTestId('sentinel-unlock-start-btn').click()
    const request = page.getByTestId('sentinel-unlock-request-output')
    await expect(request).not.toHaveValue('')
    await participant
      .getByTestId('sentinel-unlock-participant-request-input')
      .fill(await request.inputValue())
    await participant.getByTestId('sentinel-unlock-delivery-select').click()
    await participant.getByTestId(`sentinel-unlock-delivery-${storeId}`).click()
    await participant.getByTestId('sentinel-unlock-create-response-btn').click()
    const response = participant.getByTestId(
      'sentinel-unlock-generated-response-output',
    )
    await expect(response).not.toHaveValue('')
    await page
      .getByTestId('sentinel-unlock-response-input')
      .fill(await response.inputValue())
    await page.getByTestId('sentinel-unlock-add-response-btn').click()
    await expect(page.getByTestId('sentinel-unlock-progress')).toContainText(
      '2/2',
    )
    const finalize = page.getByTestId('sentinel-unlock-finalize-btn')
    await expect(finalize).toBeEnabled()
    await page.waitForTimeout(DEMO_BEAT_MS)

    // The public reset models an external session change after this UI snapshot.
    // This is a stale-readiness race, not an injected mid-finalization failure.
    await page.evaluate(() => {
      const vault = (
        window as Window & {
          __nookVault?: {
            requireManager(): { reset_vault_session(): void }
          }
        }
      ).__nookVault
      if (!vault) throw new Error('Vault harness is unavailable')
      vault.requireManager().reset_vault_session()
    })
    await expect(finalize).toBeEnabled()
    await finalize.click()

    const start = page.getByTestId('sentinel-unlock-start-btn')
    await expect(start).toBeVisible()
    await expect(start).toBeEnabled()
    await expect(finalize).toHaveCount(0)
    await expect(request).toHaveCount(0)
    await expect(page.getByTestId('vault-panel')).toHaveCount(0)
    await page.waitForTimeout(DEMO_BEAT_MS)
    await expect(start).toBeVisible()
    await expect(page.getByTestId('sentinel-unlock-initiator')).toHaveCount(0)
  } finally {
    await participantContext.close()
    await otherContext.close()
  }
})
