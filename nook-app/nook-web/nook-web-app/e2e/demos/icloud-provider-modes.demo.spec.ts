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

test('choose private or shared iCloud vault storage', async ({ page }) => {
  await page.addInitScript(() => {
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
