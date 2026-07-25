import { expect, test } from '../fixtures'
import { connectLocalVault, UI_TIMEOUT_MS } from '../helpers'

const DEMO_BEAT_MS = 700

async function demoBeat(page: Parameters<typeof connectLocalVault>[0]) {
  await page.waitForTimeout(DEMO_BEAT_MS)
}

test('approve extension pairing when the browser handoff accepts the grant', async ({
  page,
}) => {
  await connectLocalVault(page)
  await expect(page.getByTestId('vault-panel')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await demoBeat(page)

  // Use this vault session's device keys as the requested extension identity.
  // The demo only needs a valid Approve + accepted browser handoff mock; a
  // second browser context is not required to exercise the consent UI.
  const extensionDevice = await page.evaluate(async () => {
    type DemoVault = {
      manager?: {
        device_id: string
        device_public_key: string
        deviceSigningPublicKey: () => Promise<string>
      }
    }
    const manager = (window as Window & { __nookVault?: DemoVault }).__nookVault
      ?.manager
    if (!manager) throw new Error('Vault device manager unavailable')
    return {
      deviceId: manager.device_id,
      devicePublicKey: manager.device_public_key,
      deviceSigningPublicKey: await manager.deviceSigningPublicKey(),
    }
  })

  await page.getByTestId('header-lock-vault-btn').click()
  await expect(page.getByTestId('login-local-unlock-step')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await page.goto(
    `/extension-connect?device_id=${extensionDevice.deviceId}&device_public_key=${encodeURIComponent(extensionDevice.devicePublicKey)}&device_signing_public_key=${extensionDevice.deviceSigningPublicKey}&extension_id=demo-extension&device_label=Nook%20Extension&nonce=demo-nonce&scopes=vault-access,password-filling,passkey-management,sync-provider-credentials`,
  )
  await expect(page.getByTestId('login-local-unlock-step')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await page.getByTestId('unlock-vault-btn').click()
  await expect(page.getByTestId('extension-connect-consent')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await demoBeat(page)

  await page.evaluate(() => {
    const browserWindow = window as Window & {
      chrome?: { runtime?: unknown }
    }
    const chrome = browserWindow.chrome ?? {}
    Object.defineProperty(chrome, 'runtime', {
      configurable: true,
      value: {
        sendMessage: (
          _extensionId: string,
          message: unknown,
          callback: (response: unknown) => void,
        ) => {
          document.documentElement.setAttribute(
            'data-demo-extension-message',
            JSON.stringify(
              typeof message === 'object' &&
                message !== null &&
                'type' in message
                ? { type: (message as { type?: string }).type }
                : message,
            ),
          )
          callback({ ok: true })
        },
      },
    })
    if (!browserWindow.chrome) browserWindow.chrome = chrome
  })

  await page.getByTestId('approve-extension-device-btn').click()
  await expect(page.getByTestId('extension-connect-approved')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await expect(
    page.getByTestId('extension-connect-consent').getByRole('alert'),
  ).toHaveCount(0)
  await expect(page.locator('html')).toHaveAttribute(
    'data-demo-extension-message',
    JSON.stringify({ type: 'nook:extension-pairing-approved' }),
  )
  await demoBeat(page)
})
