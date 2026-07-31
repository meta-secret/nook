import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import {
  clearBrowserVault,
  openLoginProviderSetup,
  UI_TIMEOUT_MS,
} from '../helpers'

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
    ;(
      window as Window & {
        __nookDemoOpenedUrls?: string[]
      }
    ).__nookDemoOpenedUrls = opened
    const originalOpen = window.open.bind(window)
    window.open = ((url?: string | URL, ...rest: unknown[]) => {
      opened.push(String(url ?? ''))
      return originalOpen(
        url,
        ...(rest as [string | undefined, string | undefined]),
      )
    }) as typeof window.open

    const container = {
      setUpAuth: async () => {},
      whenUserSignsIn: () => new Promise(() => {}),
    }
    ;(
      window as typeof window & {
        CloudKit?: {
          configure: () => void
          getDefaultContainer: () => typeof container
        }
      }
    ).CloudKit = {
      configure: () => {},
      getDefaultContainer: () => container,
    }
  })
}

test('choose private or shared iCloud vault storage', async ({ page }) => {
  await installCloudKitStub(page)
  await page.goto('/app/')
  await clearBrowserVault(page)
  await page.reload()

  await openLoginProviderSetup(page)
  await page.getByTestId('provider-option-icloud').click()
  await expect(page.getByTestId('icloud-oauth-setup')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  // Demo harness serves on 127.0.0.1; WASM OAuth origin policy rejects it for iCloud.
  await expect(page.getByTestId('icloud-origin-unsupported')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  // Brave native-click flows must not open a second Apple window or show a
  // premature sign-in failure while the origin gate is explaining the host.
  await expect(page.getByTestId('icloud-oauth-error')).toHaveCount(0)
  await expect(page.getByTestId('icloud-sign-in-btn')).toBeVisible()
  const openedUrls = await page.evaluate(
    () =>
      (
        window as Window & {
          __nookDemoOpenedUrls?: string[]
        }
      ).__nookDemoOpenedUrls ?? [],
  )
  expect(openedUrls).toEqual([])
  await expect(page.getByTestId('icloud-mode-private')).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await demoBeat(page)

  await page.getByTestId('icloud-mode-shared').click()
  await expect(page.getByTestId('icloud-mode-shared')).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await expect(page.getByTestId('icloud-shared-target-step')).toBeVisible()
  await demoBeat(page)
})
