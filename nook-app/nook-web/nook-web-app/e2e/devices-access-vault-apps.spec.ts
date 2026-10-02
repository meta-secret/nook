import { expect, test } from './fixtures'
import { DevicesAccessScenario } from './devices-access-spec-helpers'
import { connectLocalVault, UI_TIMEOUT_MS } from './helpers'
import { installMockPasskeyRuntime } from './passkey-mock'

interface ExtensionInventoryDevice {
  readonly deviceId: string
  readonly devicePublicKey: string
  readonly deviceSigningPublicKey: string
}

/** Reads the public installation tuple through the browser's actual WASM manager. */
class BrowserInventoryDevice {
  static read(): Promise<ExtensionInventoryDevice> {
    switch (typeof window.__nookVault) {
      case 'object':
        return window.__nookVault.admitManager().match(
          async (manager) => ({
            deviceId: manager.device_id,
            devicePublicKey: manager.device_public_key,
            deviceSigningPublicKey: await manager.device_signing_public_key_js(),
          }),
          (failure) => {
            throw new Error(failure.translationKey)
          },
        )
      default:
        throw new Error('Vault debug hooks are unavailable')
    }
  }
}

test('lists the browser and enrolled extension after reload without a sync provider', async ({
  page,
  browser,
}) => {
  await new DevicesAccessScenario(page).prepare()
  await connectLocalVault(page)
  const extensionContext = await browser.newContext()
  let extensionDevice: ExtensionInventoryDevice
  try {
    await extensionContext.addInitScript(installMockPasskeyRuntime)
    const extensionPage = await extensionContext.newPage()
    await connectLocalVault(extensionPage)
    extensionDevice = await extensionPage.evaluate(BrowserInventoryDevice.read)
  } finally {
    await extensionContext.close()
  }

  const query = new URLSearchParams({
    device_id: extensionDevice.deviceId,
    device_public_key: extensionDevice.devicePublicKey,
    device_signing_public_key: extensionDevice.deviceSigningPublicKey,
    extension_id: 'inventory-test-extension',
    device_label: 'Nook Extension',
    nonce: 'inventory-test-nonce',
    scopes: 'vault-access,password-filling',
  })
  await page.goto(`/extension-connect?${query.toString()}`)
  await expect(page.getByTestId('extension-connect-consent')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await page.evaluate(() => {
    // Stub only Chrome's delivery acknowledgement; vault approval stays real.
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        runtime: {
          sendMessage(
            _extensionId: string,
            _message: { readonly type: string },
            callback: (response: { readonly ok: true }) => void,
          ): void {
            callback({ ok: true })
          },
        },
      },
    })
  })
  await page.getByTestId('approve-extension-device-btn').click()
  await expect(page).toHaveURL(/\/vault\/?$/, { timeout: UI_TIMEOUT_MS })
  await page.getByTestId('header-devices-access-btn').click()
  const identity = page.getByTestId('devices-access-identity-option')
  const apps = page.getByTestId('devices-access-app')
  await expect(identity).toHaveCount(1)
  await expect(identity).toContainText('2 apps · 1 vault')
  await expect(apps).toHaveCount(2)
  await expect(apps.filter({ hasText: 'Nook in this browser' })).toContainText(
    'Protected by',
  )
  const extension = apps.filter({ hasText: 'Nook Extension' })
  await expect(extension).toContainText('Linked to Personal')
  await expect(extension).not.toContainText('Protected by')
  await expect(extension.getByTestId('devices-access-app-id')).not.toBeVisible()
  await page.getByTestId('devices-access-layout-graph').click()
  await expect(identity).toContainText('2 apps · 1 vault')

  await page.reload()
  await expect(page.getByTestId('devices-access-key-inventory')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await expect(identity).toContainText('2 apps · 1 vault')
  await expect(apps).toHaveCount(2)
  await expect(extension).toContainText('Nook Extension')
})
