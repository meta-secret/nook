import { expect, test } from '../fixtures'
import { connectLocalVault, UI_TIMEOUT_MS } from '../helpers'
import {
  ExtensionPairedVaultIdentityDiscoveryMessageType,
  isExtensionPairedVaultIdentityDiscoveryMessage,
  OpenCompanionLauncherMessageType,
  type ExtensionPairedVaultIdentityDiscoveryMessage,
  type OpenCompanionLauncherMessage,
} from '../../../nook-web-shared/src/extension/runtime-messages'

type ExtensionInstallDemoMessage =
  ExtensionPairedVaultIdentityDiscoveryMessage | OpenCompanionLauncherMessage

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

  await page.evaluate(() => {
    const browserGlobal = globalThis as typeof globalThis & {
      chrome?: {
        runtime?: {
          sendMessage?: (
            extensionId: string,
            message: ExtensionInstallDemoMessage,
            callback: (response?: unknown) => void,
          ) => void
        }
      }
    }
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
            type === OpenCompanionLauncherMessageType.NookOpenCompanionLauncher
              ? { ok: true }
              : type ===
                  ExtensionPairedVaultIdentityDiscoveryMessageType.NookExtensionPairedVaultIdentityDiscovery
                ? {
                    type: 'nook:extension-paired-vault-identity-status',
                    payload: {
                      requestId: message.payload.requestId,
                      vaultStoreId: message.payload.vaultStoreId,
                      status: 'different-vault',
                      connectedVaultStoreId: 'store_previous_9a4f',
                      connectedVaultName: 'Previous vault',
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
  })
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
  const encodedDiscoveryMessage = await page
    .locator('html')
    .getAttribute('data-demo-extension-message')
  if (typeof encodedDiscoveryMessage !== 'string') {
    throw new Error('Paired-vault discovery message was not recorded.')
  }
  const discoveryMessage = JSON.parse(encodedDiscoveryMessage)
  if (!isExtensionPairedVaultIdentityDiscoveryMessage(discoveryMessage)) {
    throw new Error('Paired-vault discovery message was malformed.')
  }
  expect(Object.keys(discoveryMessage.payload).sort()).toEqual([
    'expiresAt',
    'requestId',
    'vaultStoreId',
  ])
  await page.getByTestId('extension-install-setup-connect').click()
  // Concrete companion request and response domains must preserve the exact
  // message envelope while the browser boundary rejects unnamed value bags.
  await expect(page.locator('html')).toHaveAttribute(
    'data-demo-extension-message',
    JSON.stringify({
      type: 'nook:open-companion-launcher',
      payload: { intent: 'pair' },
    }),
  )
  const routedTypes = JSON.parse(
    (await page
      .locator('html')
      .getAttribute('data-demo-extension-message-types')) ?? '[]',
  ) as string[]
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
