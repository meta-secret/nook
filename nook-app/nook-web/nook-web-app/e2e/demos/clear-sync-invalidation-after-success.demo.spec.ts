import { expect, test } from '../fixtures'
import {
  connectLocalVault,
  UI_TIMEOUT_MS,
  waitForStorageChainIdle,
} from '../helpers'
import { installMockPasskeyRuntime } from '../passkey-mock'

const LOCAL_DATA_STORAGE_GENERATION_KEY = 'nook-local-data-storage-generation'

test('clear a recovered scheduled sync alert on extension consent', async ({
  browser,
  page,
}) => {
  await connectLocalVault(page)
  await page.evaluate(() => window.__nookVault?.stopVaultSync())
  await waitForStorageChainIdle(page)

  await page.evaluate((markerKey) => {
    const vault = window.__nookVault
    if (!vault) throw new Error('__nookVault is unavailable')
    const originalGetItem = Storage.prototype.getItem
    let failNextMarkerRead = true
    Storage.prototype.getItem = function (key: string) {
      if (
        this === window.localStorage &&
        key === markerKey &&
        failNextMarkerRead
      ) {
        failNextMarkerRead = false
        throw new DOMException(
          'Marker read unavailable for demo.',
          'SecurityError',
        )
      }
      return Reflect.apply(originalGetItem, this, [key])
    }
    vault.startVaultSync()
  }, LOCAL_DATA_STORAGE_GENERATION_KEY)

  const vaultError = page.getByTestId('vault-error')
  await expect(vaultError).toBeVisible({ timeout: UI_TIMEOUT_MS })
  await page.evaluate(() => window.__nookVault?.stopVaultSync())

  const extensionContext = await browser.newContext()
  await extensionContext.addInitScript(installMockPasskeyRuntime)
  const extensionPage = await extensionContext.newPage()
  await connectLocalVault(extensionPage)
  const extensionDevice = await extensionPage.evaluate(async () => {
    const vault = window.__nookVault
    if (!vault)
      return { ok: false as const, error: 'Vault debug hooks are unavailable' }
    const admission = vault.admitManager()
    if (admission.isErr())
      return { ok: false as const, error: admission.error.translationKey }
    const manager = admission.value
    return {
      ok: true as const,
      deviceId: manager.device_id,
      devicePublicKey: manager.device_public_key,
      deviceSigningPublicKey: await manager.device_signing_public_key_js(),
    }
  })
  await extensionContext.close()
  if (!extensionDevice.ok) throw new Error(extensionDevice.error)

  const consentRequest = new URLSearchParams({
    device_id: extensionDevice.deviceId,
    device_public_key: extensionDevice.devicePublicKey,
    device_signing_public_key: extensionDevice.deviceSigningPublicKey,
    extension_id: 'demo-extension-id',
    device_label: 'Nook Extension - Sync recovery demo',
    nonce: 'sync-recovery-demo-nonce',
    scopes: 'vault-access,password-filling',
  })
  await page.evaluate((requestPath) => {
    const historyState: Parameters<typeof window.history.pushState>[0] = {}
    window.history.pushState(historyState, '', requestPath)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, `/extension-connect?${consentRequest}`)

  const consent = page.getByTestId('extension-connect-consent')
  await expect(consent).toBeVisible({ timeout: UI_TIMEOUT_MS })
  await expect(vaultError).toBeVisible()
  const consentWorkflowNotice = consent.locator('[role="alert"]')
  await expect(consentWorkflowNotice).toHaveCount(0)

  await page.evaluate(() => window.__nookVault?.startVaultSync())
  await expect(vaultError).toHaveCount(0, { timeout: UI_TIMEOUT_MS })
  await page.evaluate(() => window.__nookVault?.stopVaultSync())
  await expect(consent).toBeVisible()
  await expect(consentWorkflowNotice).toHaveCount(0)

  await page.evaluate(() => {
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: {
        runtime: {
          sendMessage: (
            _extensionId: string,
            _message: unknown,
            callback: (response?: { ok: true }) => void,
          ) => window.setTimeout(() => callback({ ok: true }), 10),
        },
      },
    })
  })
  await page.getByTestId('approve-extension-device-btn').click()
  await expect(page.getByTestId('extension-connect-approved')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await expect(vaultError).toHaveCount(0)
})
