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
        sendMessage: (_extensionId, _message, callback) => {
          callback({ ok: false })
        },
      },
    }
    document.documentElement.setAttribute(
      'data-nook-extension-runtime-id',
      'demo-extension-id',
    )
  })
  await expect(setupCard).toHaveAttribute('data-status', 'installed_unpaired')
  await expect(page.getByTestId('extension-install-setup-connect')).toHaveText(
    'Connect extension',
  )
  await demoBeat(page)

  await page.getByTestId('vault-settings-tab').click()
  await expect(page.getByTestId('vault-devices-section')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  const settingsRow = page.getByTestId('extension-setup-settings')
  await expect(settingsRow).toBeVisible()
  await expect(settingsRow).toHaveAttribute('data-status', 'installed_unpaired')
  await expect(page.getByTestId('extension-setup-settings-cta')).toHaveText(
    'Connect extension',
  )
  await demoBeat(page)
})
