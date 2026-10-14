import { expect, test } from '../fixtures'
import { Effect } from 'effect'
import {
  connectLocalVault,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  readLocalVaultYamlFromIdb,
  parseJson,
  openIdentitiesPage,
  openVaultPage,
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

type VaultSwitcherDiscoveryMessage = Omit<
  ExtensionPairedVaultIdentityDiscoveryMessage,
  'payload'
> & {
  readonly payload: CompanionIdentityDiscoveryObservation
}

type VaultSwitcherDemoMessage =
  VaultSwitcherDiscoveryMessage | OpenCompanionLauncherMessage

type VaultSwitcherDemoMessageTypes = {
  openCompanionLauncher: OpenCompanionLauncherMessageType
  pairedVaultIdentityDiscovery: ExtensionPairedVaultIdentityDiscoveryMessageType
}

type VaultSwitcherDemoResponse =
  { ok: true } | CompanionIdentityDiscoveryTransportResponse

type VaultSwitcherDemoChromeRuntime = {
  sendMessage?: (
    extensionId: string,
    message: VaultSwitcherDemoMessage,
    callback: (response?: VaultSwitcherDemoResponse) => void,
  ) => void
}

type VaultSwitcherPairedElsewhereSimulation = {
  messageTypes: VaultSwitcherDemoMessageTypes
  connectedVaultStoreId: string
  connectedVaultName: string
}

type ViewportBox = {
  x: number
  y: number
  width: number
  height: number
}

type ViewportBounds = {
  width: number
  height: number
}

type VisibleInViewportRequest = {
  box: ViewportBox
  viewport: ViewportBounds
}

const vaultSwitcherDemoMessageTypes: VaultSwitcherDemoMessageTypes = {
  openCompanionLauncher:
    OpenCompanionLauncherMessageType.NookOpenCompanionLauncher,
  pairedVaultIdentityDiscovery:
    ExtensionPairedVaultIdentityDiscoveryMessageType.NookExtensionPairedVaultIdentityDiscovery,
}

const DEMO_BEAT_MS = 700

async function demoBeat(page: Parameters<typeof connectLocalVault>[0]) {
  await page.waitForTimeout(DEMO_BEAT_MS)
}

function parseStoreId(yaml: string): string {
  const storeId = yaml.match(/^store_id:\s*(\S+)/m)?.[1]
  if (!storeId) {
    throw new Error('store_id missing from vault yaml')
  }
  return storeId
}

function assertBoxVisibleInViewport(request: VisibleInViewportRequest): void {
  expect(request.box.y).toBeGreaterThanOrEqual(0)
  expect(request.box.y + request.box.height).toBeLessThanOrEqual(
    request.viewport.height,
  )
  expect(request.box.x).toBeGreaterThanOrEqual(0)
}

test('list every vault on its identity card and pair the open vault with the companion', async ({
  page,
}) => {
  await connectLocalVault(page)
  await demoBeat(page)

  const vaultAYaml = await readLocalVaultYamlFromIdb(page)
  const storeA = parseStoreId(vaultAYaml)

  await openIdentitiesPage(page)
  await page.getByTestId('identity-new-vault').click()
  await expect(page.getByTestId('login-new-vault-panel')).toBeVisible()
  await page.getByTestId('login-vault-name-input').fill('Vault B')
  await page.getByTestId('login-create-additional-vault-btn').click()
  await expect
    .poll(
      async () => {
        const yaml = await readLocalVaultYamlFromIdb(page)
        return parseStoreId(yaml)
      },
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    .not.toBe(storeA)
  const vaultBYaml = await readLocalVaultYamlFromIdb(page)
  const storeB = parseStoreId(vaultBYaml)
  await demoBeat(page)

  const pairedElsewhereSimulation: VaultSwitcherPairedElsewhereSimulation = {
    messageTypes: vaultSwitcherDemoMessageTypes,
    connectedVaultStoreId: storeA,
    connectedVaultName: 'Vault A',
  }
  await page.evaluate((simulation) => {
    const runtime: VaultSwitcherDemoChromeRuntime = {
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
          message.type === simulation.messageTypes.pairedVaultIdentityDiscovery
            ? message.payload.request
            : { requestId: '', vaultStoreId: '' }
        callback(
          type === simulation.messageTypes.openCompanionLauncher
            ? { ok: true }
            : type === simulation.messageTypes.pairedVaultIdentityDiscovery
              ? {
                  ok: true,
                  status: {
                    status: 'different-vault',
                    request_id: String(discoveryRequest.requestId),
                    vault_store_id: String(discoveryRequest.vaultStoreId),
                    connected_vault_store_id: simulation.connectedVaultStoreId,
                    connected_vault_name: simulation.connectedVaultName,
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
  }, pairedElsewhereSimulation)
  await demoBeat(page)

  await openIdentitiesPage(page)
  const viewport = page.viewportSize()
  if (!viewport) {
    throw new Error('Page viewport size was not available.')
  }
  const rowLocators = page.getByTestId('identity-vault-row')
  await expect(rowLocators).toHaveCount(2)
  for (const row of await rowLocators.all()) {
    const rowBox = await row.boundingBox()
    if (!rowBox) {
      throw new Error('Identity vault row was clipped out of the viewport.')
    }
    const rowVisibility: VisibleInViewportRequest = {
      box: rowBox,
      viewport,
    }
    assertBoxVisibleInViewport(rowVisibility)
  }

  await expect(
    page.locator(
      '[data-testid="identity-vault-row"][data-store-id="' +
        storeA +
        '"][data-extension-connected="true"]',
    ),
  ).toBeVisible()
  await expect(
    page.locator(
      '[data-testid="identity-vault-row"][data-store-id="' +
        storeB +
        '"][data-extension-connected="true"]',
    ),
  ).toHaveCount(0)
  await expect(
    page.getByTestId('identity-vault-extension-badge'),
  ).toContainText('Browser extension')
  await openVaultPage(page)
  await expect(page.getByTestId('vault-pair-extension-btn')).toBeVisible()
  await page.getByTestId('vault-pair-extension-btn').click()
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
})
