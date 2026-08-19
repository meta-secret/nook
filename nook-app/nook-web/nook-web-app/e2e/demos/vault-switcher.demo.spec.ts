import { expect, test } from '../fixtures'
import {
  connectLocalVault,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  readLocalVaultYamlFromIdb,
  UI_TIMEOUT_MS,
} from '../helpers'
import {
  ExtensionPairedVaultIdentityDiscoveryMessageType,
  isOpenCompanionLauncherMessage,
  OpenCompanionLauncherIntent,
  OpenCompanionLauncherMessageType,
  type ExtensionPairedVaultIdentityDiscoveryMessage,
  type ExtensionPairedVaultIdentityStatusMessage,
  type OpenCompanionLauncherMessage,
} from '../../../nook-web-shared/src/extension/runtime-messages'

type VaultSwitcherDemoMessage =
  ExtensionPairedVaultIdentityDiscoveryMessage | OpenCompanionLauncherMessage

type VaultSwitcherDemoMessageTypes = {
  openCompanionLauncher: OpenCompanionLauncherMessageType
  pairedVaultIdentityDiscovery: ExtensionPairedVaultIdentityDiscoveryMessageType
}

type VaultSwitcherDemoResponse =
  { ok: true } | { ok: false } | ExtensionPairedVaultIdentityStatusMessage

type VaultSwitcherDemoChromeRuntime = {
  sendMessage?: (
    extensionId: string,
    message: VaultSwitcherDemoMessage,
    callback: (response?: VaultSwitcherDemoResponse) => void,
  ) => void
}

type VaultSwitcherDemoBrowserGlobal = typeof globalThis & {
  chrome?: { runtime?: VaultSwitcherDemoChromeRuntime }
}

type VaultSwitcherPairedElsewhereMock = {
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
  const match = yaml.match(/^store_id:\s*(\S+)/m)
  if (!match) {
    throw new Error('store_id missing from vault yaml')
  }
  return match[1]
}

function assertBoxVisibleInViewport(request: VisibleInViewportRequest): void {
  expect(request.box.y).toBeGreaterThanOrEqual(0)
  expect(request.box.y + request.box.height).toBeLessThanOrEqual(
    request.viewport.height,
  )
  expect(request.box.x).toBeGreaterThanOrEqual(0)
}

test('list every local vault and pair the open vault with the companion', async ({
  page,
}) => {
  await connectLocalVault(page)
  await demoBeat(page)

  const vaultAYaml = await readLocalVaultYamlFromIdb(page)
  const storeA = parseStoreId(vaultAYaml)

  await page.getByTestId('vault-switcher-trigger').click()
  await expect(page.getByTestId('vault-switcher-menu')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await page.getByTestId('vault-switcher-admin-btn').click()
  await expect(page.getByTestId('vault-admin-panel')).toBeVisible()
  await page.getByTestId('vault-admin-create-input').fill('Vault B')
  await page.getByTestId('vault-admin-create-btn').click()
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

  const pairedElsewhereMock: VaultSwitcherPairedElsewhereMock = {
    messageTypes: vaultSwitcherDemoMessageTypes,
    connectedVaultStoreId: storeA,
    connectedVaultName: 'Vault A',
  }
  await page.evaluate((mock) => {
    const browserGlobal = globalThis as VaultSwitcherDemoBrowserGlobal
    browserGlobal.chrome = {
      runtime: {
        sendMessage: (_extensionId, message, callback) => {
          document.documentElement.setAttribute(
            'data-demo-extension-message',
            JSON.stringify(message),
          )
          const type = message.type
          const routedTypes = JSON.parse(
            document.documentElement.getAttribute(
              'data-demo-extension-message-types',
            ) ?? '[]',
          ) as string[]
          if (type) {
            routedTypes.push(type)
            document.documentElement.setAttribute(
              'data-demo-extension-message-types',
              JSON.stringify(routedTypes),
            )
          }
          callback(
            type === mock.messageTypes.openCompanionLauncher
              ? { ok: true }
              : type === mock.messageTypes.pairedVaultIdentityDiscovery
                ? {
                    type: 'nook:extension-paired-vault-identity-status',
                    payload: {
                      requestId: message.payload.requestId,
                      vaultStoreId: message.payload.vaultStoreId,
                      status: 'different-vault',
                      connectedVaultStoreId: mock.connectedVaultStoreId,
                      connectedVaultName: mock.connectedVaultName,
                    },
                  }
                : { ok: false },
          )
        },
      },
    }
    document.documentElement.setAttribute(
      'data-nook-extension-runtime-id',
      'demo-extension-id',
    )
  }, pairedElsewhereMock)
  await demoBeat(page)

  await page.getByTestId('vault-switcher-trigger').click()
  const menu = page.getByTestId('vault-switcher-menu')
  await expect(menu).toBeVisible({ timeout: UI_TIMEOUT_MS })
  const menuBox = await menu.boundingBox()
  if (!menuBox) {
    throw new Error('Vault switcher menu was not rendered in the viewport.')
  }
  const viewport = page.viewportSize()
  if (!viewport) {
    throw new Error('Page viewport size was not available.')
  }
  const menuVisibility: VisibleInViewportRequest = {
    box: menuBox,
    viewport,
  }
  assertBoxVisibleInViewport(menuVisibility)

  const optionLocators = page.getByTestId('vault-switcher-option')
  await expect(optionLocators).toHaveCount(2)
  const options = await optionLocators.all()
  for (const option of options) {
    const optionBox = await option.boundingBox()
    if (!optionBox) {
      throw new Error('Vault switcher option was clipped out of the viewport.')
    }
    const optionVisibility: VisibleInViewportRequest = {
      box: optionBox,
      viewport,
    }
    assertBoxVisibleInViewport(optionVisibility)
  }

  await expect(
    page.locator(
      '[data-testid="vault-switcher-option"][data-store-id="' +
        storeA +
        '"][data-extension-connected="true"]',
    ),
  ).toBeVisible()
  await expect(
    page.locator(
      '[data-testid="vault-switcher-option"][data-store-id="' +
        storeB +
        '"][data-extension-connected="true"]',
    ),
  ).toHaveCount(0)
  await expect(
    page.getByTestId('vault-switcher-extension-badge'),
  ).toContainText('Browser extension')
  await expect(page.getByTestId('vault-switcher-pair-btn')).toBeVisible()
  await page.getByTestId('vault-switcher-pair-btn').click()
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
  const launcherMessage = JSON.parse(encodedLauncherMessage)
  if (!isOpenCompanionLauncherMessage(launcherMessage)) {
    throw new Error('Companion launcher message was malformed.')
  }
  expect(launcherMessage.payload).toEqual({ intent: 'pair' })
})
