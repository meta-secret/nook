import { expect, test } from '../fixtures'
import {
  connectLocalVault,
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

test('offer browser extension install on vault home and in Devices', async ({
  page,
}) => {
  await connectLocalVault(page)
  await demoBeat(page)

  const setupCard = page.getByTestId('extension-install-setup')
  await expect(setupCard).toBeVisible({ timeout: UI_TIMEOUT_MS })
  await expect(setupCard).toHaveAttribute('data-status', 'not_installed')
  await expect(page.getByTestId('extension-install-setup-cta')).toBeVisible()
  // Install CTA stays offered until the companion reports a paired vault.
  await expect(page.getByTestId('extension-install-setup-cta')).toBeEnabled()
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
          routedTypesAttribute ?? '[]',
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
  await expect(setupCard).toHaveAttribute('data-status', 'paired_elsewhere')
  await expect(page.getByTestId('extension-connected-vault')).toContainText(
    'Previous vault',
  )
  await expect(page.getByTestId('extension-install-setup-connect')).toHaveText(
    'Switch extension vault',
  )
  await expect(page.locator('html')).toHaveAttribute(
    'data-demo-extension-message-types',
    /nook:extension-paired-vault-identity-discovery/,
  )
  await page.getByTestId('extension-install-setup-connect').click()
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
  const launcherMessage: unknown = parseJson(encodedLauncherMessage)
  if (!OpenCompanionLauncherMessageGuard.is(launcherMessage)) {
    throw new Error('Companion launcher message was malformed.')
  }
  expect(launcherMessage.payload).toEqual({ intent: 'pair' })
  const routedTypes = requireStringArray(
    parseJson(
      (await page
        .locator('html')
        .evaluate(
          (element) =>
            element.attributes.getNamedItem('data-demo-extension-message-types')
              ?.value,
        )) ?? '[]',
    ),
    'routed extension message types',
  )
  expect(routedTypes).toEqual([
    'nook:extension-paired-vault-identity-discovery',
    'nook:open-companion-launcher',
  ])
  // Launching the session-owned pairing operation must not optimistically
  // replace the verified extension identity before a new grant is accepted.
  await expect(setupCard).toHaveAttribute('data-status', 'paired_elsewhere')
  await expect(page.getByTestId('extension-connected-vault')).toContainText(
    'Previous vault',
  )
  // Companion pair intent opens Simple Vault /extension-connect consent.
  // Grant acceptance (reload-safe signing-seed persistence and rejected-import
  // rollback) is covered by extension passkey-session e2e. Companion WASM for
  // that Node/Playwright path loads from disk when file: fetch is unavailable.
  await expect(
    page.getByTestId('extension-install-setup-connect'),
  ).toBeVisible()
  await expect(setupCard).toHaveAttribute('data-status', 'paired_elsewhere')
  await demoBeat(page)

  await page.getByTestId('vault-settings-tab').click()
  await expect(page.getByTestId('vault-devices-section')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  const settingsRow = page.getByTestId('extension-setup-settings')
  await expect(settingsRow).toBeVisible()
  await expect(settingsRow).toHaveAttribute('data-status', 'paired_elsewhere')
  await expect(
    page.getByTestId('extension-setup-settings-connected-vault'),
  ).toContainText('Previous vault')
  await expect(page.getByTestId('extension-setup-settings-cta')).toHaveText(
    'Switch extension vault',
  )
  // Moving between extension setup surfaces must not replay the session-owned
  // launcher request. The browser lifecycle keeps one operation per click.
  const routedTypesAfterSettings = requireStringArray(
    parseJson(
      (await page
        .locator('html')
        .evaluate(
          (element) =>
            element.attributes.getNamedItem('data-demo-extension-message-types')
              ?.value,
        )) ?? '[]',
    ),
    'routed extension message types after settings',
  )
  expect(routedTypesAfterSettings).toEqual([
    extensionInstallDemoMessageTypes.pairedVaultIdentityDiscovery,
    extensionInstallDemoMessageTypes.openCompanionLauncher,
    extensionInstallDemoMessageTypes.pairedVaultIdentityDiscovery,
  ])
  await demoBeat(page)
})

test('accept delayed extension pairing acknowledgement without duplicate delivery', async ({
  browser,
  page,
}) => {
  await connectLocalVault(page)

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

  await page.goto(
    `/extension-connect?device_id=${extensionDevice.deviceId}&device_public_key=${encodeURIComponent(extensionDevice.devicePublicKey)}&device_signing_public_key=${extensionDevice.deviceSigningPublicKey}&extension_id=demo-extension-id&device_label=Nook%20Extension%20-%20UI%20demo&nonce=demo-nonce&scopes=vault-access,password-filling`,
  )
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
  await expect(consent.getByRole('alert')).toHaveCount(0)

  await expect(page.getByTestId('extension-connect-approved')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await expect(html).toHaveAttribute('data-demo-pairing-delivery-count', '1')
  await expect(consent.getByRole('alert')).toHaveCount(0)
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

  test('hide browser extension installation on vault home and in Devices', async ({
    page,
  }) => {
    await connectLocalVault(page)
    await demoBeat(page)

    await expect(page.getByTestId('extension-install-setup')).toHaveCount(0)
    await expect(page.getByTestId('extension-install-setup-cta')).toHaveCount(0)
    await demoBeat(page)

    await page.getByTestId('vault-settings-tab').click()
    await expect(page.getByTestId('vault-devices-section')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(page.getByTestId('extension-setup-settings')).toHaveCount(0)
    await expect(page.getByTestId('extension-setup-settings-cta')).toHaveCount(
      0,
    )
    await demoBeat(page)
  })
})
