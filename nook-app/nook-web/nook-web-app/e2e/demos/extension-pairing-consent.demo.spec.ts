import { expect, test } from '../fixtures'
import { createLocalVaultOnLogin, UI_TIMEOUT_MS } from '../helpers'
import { installMockPasskeyRuntime } from '../passkey-mock'

const DEMO_BEAT_MS = 700

async function demoBeat(page: Parameters<typeof createLocalVaultOnLogin>[0]) {
  await page.waitForTimeout(DEMO_BEAT_MS)
}

test('approve extension pairing when the browser handoff accepts the grant', async ({
  page,
  browser,
}) => {
  await createLocalVaultOnLogin(page, 'Demo pairing vault')
  await expect(page.getByTestId('vault-panel')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await demoBeat(page)

  const extensionContext = await browser.newContext()
  await extensionContext.addInitScript(installMockPasskeyRuntime)
  const extensionPage = await extensionContext.newPage()
  await extensionPage.goto(new URL(page.url()).origin)
  await expect(
    extensionPage.getByTestId('login-create-vault-chooser'),
  ).toBeVisible({ timeout: UI_TIMEOUT_MS * 2 })
  const extensionDevice = await extensionPage.evaluate(async () => {
    type DemoVault = {
      manager?: {
        device_id: string
        device_public_key: string
        deviceSigningPublicKey: () => Promise<string>
      }
    }
    const manager = (window as Window & { __nookVault?: DemoVault }).__nookVault
      ?.manager
    if (!manager) throw new Error('Extension device manager unavailable')
    let lastError = 'Extension device identity unavailable'
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        return {
          deviceId: manager.device_id,
          devicePublicKey: manager.device_public_key,
          deviceSigningPublicKey: await manager.deviceSigningPublicKey(),
        }
      } catch (caught) {
        lastError = caught instanceof Error ? caught.message : String(caught)
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
    throw new Error(lastError)
  })
  await extensionContext.close()

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
