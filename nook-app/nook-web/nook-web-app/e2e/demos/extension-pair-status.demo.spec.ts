import { expect, test } from '../fixtures'
import {
  connectLocalVault,
  readLocalVaultYamlFromIdb,
  UI_TIMEOUT_MS,
} from '../helpers'
import {
  ExtensionPairedVaultIdentityDiscoveryMessageType,
  type CompanionIdentityDiscoveryTransportResponse,
  type ExtensionPairedVaultIdentityDiscoveryMessage,
} from '../../../nook-web-shared/src/extension/runtime-messages'
import type {
  CompanionIdentityDiscoveryObservation,
  CompanionIdentityStatus,
} from '../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

type ExtensionPairStatusDemoDiscoveryMessage = Omit<
  ExtensionPairedVaultIdentityDiscoveryMessage,
  'payload'
> & {
  readonly payload: CompanionIdentityDiscoveryObservation
}

type ExtensionPairStatusDemoMessage = ExtensionPairStatusDemoDiscoveryMessage

type ExtensionPairStatusDemoRuntime = {
  sendMessage?: (
    extensionId: string,
    message: ExtensionPairStatusDemoMessage,
    callback: (response?: CompanionIdentityDiscoveryTransportResponse) => void,
  ) => void
}

type ExtensionPairStatusDemoSimulation = {
  discoveryType: ExtensionPairedVaultIdentityDiscoveryMessageType
  pairedVaultStoreId: string
  pairedVaultName: string
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

test('show paired and unpaired vault status before extension unlock', async ({
  page,
}) => {
  await connectLocalVault(page)
  const pairedVaultStoreId = parseStoreId(await readLocalVaultYamlFromIdb(page))
  const pairedVaultName = (
    await page.getByTestId('vault-switcher-trigger').innerText()
  ).trim()

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
      async () =>
        parseStoreId(await readLocalVaultYamlFromIdb(page)),
      { timeout: UI_TIMEOUT_MS },
    )
    .not.toBe(pairedVaultStoreId)
  const unpairedVaultStoreId = parseStoreId(
    await readLocalVaultYamlFromIdb(page),
  )

  await page.getByTestId('header-lock-vault-btn').click()
  await expect(page.getByTestId('login-local-unlock-step')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })

  const simulation: ExtensionPairStatusDemoSimulation = {
    discoveryType:
      ExtensionPairedVaultIdentityDiscoveryMessageType.NookExtensionPairedVaultIdentityDiscovery,
    pairedVaultStoreId,
    pairedVaultName,
  }
  await page.addInitScript((demo) => {
    const runtime: ExtensionPairStatusDemoRuntime = {
      sendMessage: (_extensionId, message, callback) => {
        if (message.type !== demo.discoveryType) {
          callback({ ok: false })
          return
        }
        const request = message.payload.request
        const status: CompanionIdentityStatus =
          request.vaultStoreId === demo.pairedVaultStoreId
            ? {
                status: 'locked',
                request_id: String(request.requestId),
                vault_store_id: String(request.vaultStoreId),
              }
            : {
                status: 'different-vault',
                request_id: String(request.requestId),
                vault_store_id: String(request.vaultStoreId),
                connected_vault_store_id: demo.pairedVaultStoreId,
                connected_vault_name: demo.pairedVaultName,
              }
        callback({ ok: true, status })
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
  }, simulation)

  await page.goto(
    '/extension-connect?device_id=demo-device&device_public_key=demo-public-key&device_signing_public_key=demo-signing-key&extension_id=demo-extension-id&device_label=Browser%20extension&nonce=demo-nonce&scopes=vault-access,password-filling',
  )
  await expect(page).toHaveURL((url) => url.pathname === '/extension-connect')
  await expect(page.getByTestId('login-local-unlock-step')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })

  const pairedVaultOption = page.locator(
    `[data-testid="login-vault-option"][data-store-id="${pairedVaultStoreId}"]`,
  )
  const unpairedVaultOption = page.locator(
    `[data-testid="login-vault-option"][data-store-id="${unpairedVaultStoreId}"]`,
  )
  await expect(pairedVaultOption).toBeVisible({ timeout: UI_TIMEOUT_MS })
  await expect(
    pairedVaultOption.getByTestId('login-vault-extension-pairing-status'),
  ).toHaveText('Paired with this extension')
  await expect(unpairedVaultOption).toBeVisible()
  await expect(
    unpairedVaultOption.getByTestId('login-vault-extension-pairing-status'),
  ).toHaveText('Not paired with this extension')
  await expect(
    unpairedVaultOption.getByTestId('login-vault-extension-connected-vault'),
  ).toContainText(pairedVaultName)
  await demoBeat(page)

  await unpairedVaultOption.click()
  await expect(page.getByTestId('login-local-unlock-step')).toBeVisible()
  const selectedUnpairedVault = page.locator(
    `[data-testid="login-vault-card"][data-store-id="${unpairedVaultStoreId}"]`,
  )
  await expect(
    selectedUnpairedVault.getByTestId(
      'login-vault-extension-pairing-status',
    ),
  ).toHaveText('Not paired with this extension')
  await expect(
    selectedUnpairedVault.getByTestId(
      'login-vault-extension-connected-vault',
    ),
  ).toContainText(pairedVaultName)
  await expect(
    page.getByTestId('login-vault-extension-pairing-purpose'),
  ).toContainText('Choose this vault to connect it to the browser extension.')
  await demoBeat(page)
})
