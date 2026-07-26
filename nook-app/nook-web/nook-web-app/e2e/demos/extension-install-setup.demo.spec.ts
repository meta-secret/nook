import { expect, test } from '../fixtures'
import { connectLocalVault, UI_TIMEOUT_MS } from '../helpers'

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
  await demoBeat(page)

  await page.evaluate(() => {
    const browserGlobal = globalThis as typeof globalThis & {
      chrome?: {
        runtime?: {
          sendMessage?: (
            extensionId: string,
            message: unknown,
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
          const type = (message as { type?: string }).type
          callback(
            type === 'nook:open-companion-launcher'
              ? { ok: true }
              : type === 'nook:extension-paired-vault-identity-discovery'
                ? {
                    type: 'nook:extension-paired-vault-identity-status',
                    payload: {
                      requestId: (
                        message as {
                          payload: { requestId: string }
                        }
                      ).payload.requestId,
                      vaultStoreId: (
                        message as {
                          payload: { vaultStoreId: string }
                        }
                      ).payload.vaultStoreId,
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
  await page.getByTestId('extension-install-setup-connect').click()
  await expect(page.locator('html')).toHaveAttribute(
    'data-demo-extension-message',
    JSON.stringify({
      type: 'nook:open-companion-launcher',
      payload: { intent: 'pair' },
    }),
  )
  // Companion pair intent is the entry into Simple Vault /extension-connect
  // consent; grant acceptance after Approve is covered by extension e2e.
  await expect(
    page.getByTestId('extension-install-setup-connect'),
  ).toBeVisible()
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
