import { expect, test, type Browser } from '../fixtures'
import { Effect } from 'effect'
import {
  connectLocalVault,
  openOpenVaultPanel,
  parseJson,
  requireStringArray,
  UI_TIMEOUT_MS,
} from '../helpers'
import {
  ExtensionPairedVaultIdentityDiscoveryMessageType,
  OpenCompanionLauncherMessage as OpenCompanionLauncherMessageGuard,
  OpenCompanionLauncherIntent,
  OpenCompanionLauncherMessageType,
  type CompanionIdentityDiscoveryTransportResponse,
  type ExtensionPairedVaultIdentityDiscoveryMessage,
  type OpenCompanionLauncherMessage,
} from '../../../nook-web-shared/src/extension/runtime-messages'
import type {
  CompanionIdentityDiscoveryObservation,
  CompanionIdentityStatus,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { installMockPasskeyRuntime } from '../passkey-mock'

type ExtensionInstallDemoDiscoveryMessage = Omit<
  ExtensionPairedVaultIdentityDiscoveryMessage,
  'payload'
> & {
  readonly payload: CompanionIdentityDiscoveryObservation
}

type ExtensionInstallDemoMessage =
  ExtensionInstallDemoDiscoveryMessage | OpenCompanionLauncherMessage

type ExtensionInstallDemoMessageTypes = {
  openCompanionLauncher: OpenCompanionLauncherMessageType
  pairedVaultIdentityDiscovery: ExtensionPairedVaultIdentityDiscoveryMessageType
}

type ExtensionInstallDemoResponse =
  { ok: true } | CompanionIdentityDiscoveryTransportResponse

type ExtensionInstallDemoChromeRuntime = {
  sendMessage?: (
    extensionId: string,
    message: ExtensionInstallDemoMessage,
    callback: (response?: ExtensionInstallDemoResponse) => void,
  ) => void
}

const extensionInstallDemoMessageTypes: ExtensionInstallDemoMessageTypes = {
  openCompanionLauncher:
    OpenCompanionLauncherMessageType.NookOpenCompanionLauncher,
  pairedVaultIdentityDiscovery:
    ExtensionPairedVaultIdentityDiscoveryMessageType.NookExtensionPairedVaultIdentityDiscovery,
}

// The repository-wide typed API contract covers the shared Svelte workspace
// used by this flow. Keep this demo as the visible proof that extension install
// discovery still crosses that typed boundary successfully.
const DEMO_BEAT_MS = 700

async function demoBeat(page: Parameters<typeof connectLocalVault>[0]) {
  await page.waitForTimeout(DEMO_BEAT_MS)
}

/** A second local vault whose device keys stand in for an extension's. */
async function createExtensionDevice(browser: Browser) {
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
  return extensionDevice
}

test("offer the browser extension from the open vault's panel", async ({
  page,
}) => {
  await connectLocalVault(page)
  await openOpenVaultPanel(page)
  await demoBeat(page)

  const install = page.getByTestId('vault-extension-install')
  await expect(install).toBeVisible({ timeout: UI_TIMEOUT_MS })
  // Install stays offered until the companion reports itself.
  await expect(install).toBeEnabled()
  await demoBeat(page)

  await page.evaluate((messageTypes) => {
    const runtime: ExtensionInstallDemoChromeRuntime = {
      sendMessage: (_extensionId, message, callback) => {
        document.documentElement.setAttribute(
          'data-demo-extension-message',
          JSON.stringify(message),
        )
        const type = message.type
        const routedTypesAttribute =
          document.documentElement.attributes.getNamedItem(
            'data-demo-extension-message-types',
          )?.value
        const parsedRoutedTypes: unknown = JSON.parse(
          typeof routedTypesAttribute === 'string'
            ? routedTypesAttribute
            : '[]',
        )
        if (!Array.isArray(parsedRoutedTypes)) {
          throw new Error('Routed message types were not an array.')
        }
        const routedTypes: string[] = []
        for (const routedType of parsedRoutedTypes) {
          if (typeof routedType !== 'string') {
            throw new Error('Routed message types contained a non-string.')
          }
          routedTypes.push(routedType)
        }
        if (type) {
          routedTypes.push(type)
          document.documentElement.setAttribute(
            'data-demo-extension-message-types',
            JSON.stringify(routedTypes),
          )
        }
        const discoveryRequest =
          message.type === messageTypes.pairedVaultIdentityDiscovery
            ? message.payload.request
            : { requestId: '', vaultStoreId: '' }
        callback(
          type === messageTypes.openCompanionLauncher
            ? { ok: true }
            : type === messageTypes.pairedVaultIdentityDiscovery
              ? {
                  ok: true,
                  status: {
                    status: 'different-vault',
                    request_id: String(discoveryRequest.requestId),
                    vault_store_id: String(discoveryRequest.vaultStoreId),
                    connected_vault_store_id: 'store_previous_9a4f',
                    connected_vault_name: 'Previous vault',
                  } satisfies CompanionIdentityStatus,
                }
              : { ok: false },
        )
      },
    }
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: { runtime },
    })
    document.documentElement.setAttribute(
      'data-nook-extension-runtime-id',
      'demo-extension-id',
    )
  }, extensionInstallDemoMessageTypes)
  // The extension serves several vaults; this one is not connected yet.
  const connect = page.getByTestId('vault-pair-extension-btn')
  await expect(connect).toBeVisible({ timeout: UI_TIMEOUT_MS })
  await expect(install).toHaveCount(0)
  await expect(page.locator('html')).toHaveAttribute(
    'data-demo-extension-message-types',
    /nook:extension-paired-vault-identity-discovery/,
  )
  await connect.click()
  // Concrete companion request and response domains must preserve the exact
  // message envelope while the browser boundary rejects unnamed value bags.
  await expect(page.locator('html')).toHaveAttribute(
    'data-demo-extension-message',
    JSON.stringify({
      type: 'nook:open-companion-launcher',
      payload: { intent: OpenCompanionLauncherIntent.Pair },
    }),
  )
  const encodedLauncherMessage = await page
    .locator('html')
    .getAttribute('data-demo-extension-message')
  if (typeof encodedLauncherMessage !== 'string') {
    throw new Error('Companion launcher message was not recorded.')
  }
  const launcherMessage = Effect.runSync(
    Effect.result(
      OpenCompanionLauncherMessageGuard.decode(
        parseJson(encodedLauncherMessage),
      ),
    ),
  )
  if (launcherMessage._tag === 'Failure') {
    throw new Error('Companion launcher message was malformed.')
  }
  expect(launcherMessage.success.intent).toBe(OpenCompanionLauncherIntent.Pair)
  const routedTypesAttribute = await page
    .locator('html')
    .evaluate(
      (element) =>
        element.attributes.getNamedItem('data-demo-extension-message-types')
          ?.value,
    )
  const routedTypes = requireStringArray(
    parseJson(
      typeof routedTypesAttribute === 'string' ? routedTypesAttribute : '[]',
    ),
    'routed extension message types',
  )
  expect(routedTypes).toEqual([
    'nook:extension-paired-vault-identity-discovery',
    'nook:open-companion-launcher',
  ])
  // Launching the session-owned pairing operation must not optimistically
  // mark this vault connected before a new grant is accepted.
  await expect(connect).toBeVisible()
  await expect(page.getByTestId('vault-extension-connected')).toHaveCount(0)
  await demoBeat(page)
})

test('automatically return after accessible extension approval confirmation', async ({
  browser,
  page,
}) => {
  await connectLocalVault(page)

  const extensionDevice = await createExtensionDevice(browser)

  await page.goto(
    `/extension-connect?device_id=${extensionDevice.deviceId}&device_public_key=${encodeURIComponent(extensionDevice.devicePublicKey)}&device_signing_public_key=${extensionDevice.deviceSigningPublicKey}&extension_id=demo-extension-id&device_label=Nook%20Extension%20-%20UI%20demo&nonce=demo-nonce&scopes=vault-access,password-filling`,
  )
  // This visible consent flow exercises the shared App -> AppSurface ->
  // ExtensionConnectConsentWorkspace -> ExtensionConnectConsent path. The
  // Sentinel build replaces that last surface with its intentionally hidden
  // ExtensionConnectDisabled no-op and denies this route altogether.
  const consent = page.getByTestId('extension-connect-consent')
  await expect(consent).toBeVisible({ timeout: UI_TIMEOUT_MS })

  await page.evaluate((acknowledgementDelayMs) => {
    let deliveryCount = 0
    const runtime: ExtensionInstallDemoChromeRuntime = {
      sendMessage: (_extensionId, _message, callback) => {
        deliveryCount += 1
        document.documentElement.setAttribute(
          'data-demo-pairing-delivery-count',
          String(deliveryCount),
        )
        window.setTimeout(() => callback({ ok: true }), acknowledgementDelayMs)
      },
    }
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      value: { runtime },
    })
  }, 6_000)

  await page.getByTestId('approve-extension-device-btn').click()
  const html = page.locator('html')
  await expect(html).toHaveAttribute('data-demo-pairing-delivery-count', '1')

  await page.waitForTimeout(5_200)
  await expect(html).toHaveAttribute('data-demo-pairing-delivery-count', '1')
  await expect(
    consent.locator('[data-extension-pairing-rejection-reason]'),
  ).toHaveCount(0)

  const approvedMessage = 'Extension device approved.'
  const approvedConfirmation = consent.getByRole('status')
  await expect(approvedConfirmation).toHaveCount(1, {
    timeout: UI_TIMEOUT_MS,
  })
  await expect(approvedConfirmation).toBeVisible()
  await expect(approvedConfirmation).toHaveText(approvedMessage)
  await expect(page.getByText(approvedMessage, { exact: true })).toHaveCount(1)
  await expect(consent.getByRole('alert')).toHaveCount(0)
  await expect(consent.getByRole('button', { name: 'Done' })).toHaveCount(0)

  await expect(page).toHaveURL(/\/vault\/?$/, { timeout: UI_TIMEOUT_MS })
  await expect(page.getByTestId('vault-panel')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await expect(consent).toHaveCount(0)
  const approvalToast = page.getByTestId('app-success')
  await expect(approvalToast).toBeVisible({ timeout: UI_TIMEOUT_MS })
  await expect(approvalToast).toHaveAttribute('role', 'status')
  await expect(approvalToast).toHaveText(approvedMessage)
  await expect(html).toHaveAttribute('data-demo-pairing-delivery-count', '1')
  await demoBeat(page)
})

test("show an extension's connection request beside the locked identity", async ({
  browser,
  page,
}) => {
  await connectLocalVault(page)

  const extensionDevice = await createExtensionDevice(browser)

  await page.getByTestId('header-lock-vault-btn').click()
  await expect(page.getByTestId('identity-vault-row').first()).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await page.goto(
    `/extension-connect?device_id=${extensionDevice.deviceId}&device_public_key=${encodeURIComponent(extensionDevice.devicePublicKey)}&device_signing_public_key=${extensionDevice.deviceSigningPublicKey}&extension_id=demo-extension-id&device_label=Nook%20Extension%20-%20UI%20demo&nonce=demo-nonce&scopes=vault-access,password-filling`,
  )
  // The locked browser shows the request beside the identity card. The
  // Sentinel build swaps this panel for its hidden
  // ExtensionRequestPanelDisabled no-op, so no extension scope ships there.
  const request = page.getByTestId('extension-request-panel')
  await expect(request).toBeVisible({ timeout: UI_TIMEOUT_MS })
  await expect(page.getByTestId('extension-request-title')).toContainText(
    'Nook Extension - UI demo',
  )
  await demoBeat(page)

  await request.getByTestId('extension-request-vault').first().click()
  await expect(page.getByTestId('extension-connect-consent')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await demoBeat(page)
})

test.describe('mobile browser', () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 },
  })

  test("hide browser extension installation in the open vault's panel", async ({
    page,
  }) => {
    await connectLocalVault(page)
    await openOpenVaultPanel(page)
    await demoBeat(page)

    await expect(page.getByTestId('vault-panel-import')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(page.getByTestId('vault-extension-install')).toHaveCount(0)
    await expect(page.getByTestId('vault-pair-extension-btn')).toHaveCount(0)
    await demoBeat(page)
  })
})
