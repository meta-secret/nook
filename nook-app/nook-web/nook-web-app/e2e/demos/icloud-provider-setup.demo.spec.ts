import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import {
  clearBrowserVault,
  openLoginProviderSetup,
  UI_TIMEOUT_MS,
} from '../helpers'
import { parseJson, requireStringArray } from '../helpers'

const DEMO_BEAT_MS = 700

async function demoBeat(page: Page) {
  await page.waitForTimeout(DEMO_BEAT_MS)
}

async function installCloudKitStub(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'brave', {
      configurable: true,
      value: {},
    })
    const opened: string[] = []
    const originalOpen = window.open.bind(window)
    Object.defineProperty(window, 'open', {
      configurable: true,
      value: (url?: string | URL, target = '', features = '') => {
        opened.push(String(url))
        document.documentElement.setAttribute(
          'data-demo-opened-urls',
          JSON.stringify(opened),
        )
        return originalOpen(url, target, features)
      },
    })

    const container = {
      setUpAuth: async () => {},
      whenUserSignsIn: () => new Promise<never>(() => {}),
    }
    Object.defineProperty(window, 'CloudKit', {
      configurable: true,
      value: {
        configure: () => {},
        getDefaultContainer: () => container,
      },
    })
  })
}

test('iCloud setup shows the host gate and the CloudKit share step', async ({
  page,
}) => {
  await installCloudKitStub(page)
  await page.goto('/app/')
  await clearBrowserVault(page)
  await page.reload()

  await openLoginProviderSetup(page)
  const iCloudProvider = page.getByTestId('provider-option-icloud')
  await expect(iCloudProvider).toBeVisible()
  await iCloudProvider.click()
  await expect(page.getByTestId('icloud-oauth-setup')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  // Demo harness serves on 127.0.0.1; WASM OAuth origin policy rejects it for iCloud.
  await expect(page.getByTestId('icloud-origin-unsupported')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await expect(page.getByTestId('icloud-sign-in-btn')).toHaveClass(
    /pointer-events-none/,
  )
  // On the unsupported demo origin, show the host gate rather than a premature
  // iCloud sign-in failure, and do not open a second Apple auth window.
  await expect(page.getByTestId('icloud-oauth-error')).toHaveCount(0)
  const openedUrls = requireStringArray(
    parseJson(
      (await page.locator('html').getAttribute('data-demo-opened-urls')) ||
        '[]',
    ),
    'opened iCloud URLs',
  )
  expect(openedUrls).toEqual([])
  // Connect & sync waits for sign-in; it creates the vault's CloudKit share.
  await expect(page.getByTestId('icloud-setup-sync-step')).toBeVisible()
  await demoBeat(page)
})
