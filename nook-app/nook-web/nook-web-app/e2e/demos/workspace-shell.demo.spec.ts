import { expect, test } from '../fixtures'
import {
  clearBrowserVault,
  connectLocalVault,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  UI_TIMEOUT_MS,
} from '../helpers'

const DEMO_BEAT_MS = 700

test('the vault page holds items; identity management has its own rail', async ({
  page,
}) => {
  await page.goto('/app/')
  await clearBrowserVault(page)
  await page.reload()
  await connectLocalVault(page)
  await expect(page.getByTestId('vault-panel')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })

  // The vault page band carries Import and the browser extension, and no
  // identity management.
  await expect(page.getByTestId('vault-import-btn')).toBeVisible()
  await expect(page.getByTestId('vault-extension-install')).toBeVisible()
  await expect(page.getByTestId('manage-nav')).toHaveCount(0)
  await page.waitForTimeout(DEMO_BEAT_MS)

  // Manage on the identity card opens its overview and the rail.
  await page.getByTestId('header-identities-btn').click()
  await page.getByTestId('identity-manage').first().click()
  await expect(page).toHaveURL(/\/identity$/)
  const rail = page.getByTestId('manage-nav')
  await expect(rail).toBeVisible()
  for (const item of [
    'overview',
    'vaults',
    'sync',
    'devices',
    'keys',
    'passwords',
    'settings',
  ]) {
    await expect(page.getByTestId(`manage-nav-${item}`)).toBeVisible()
  }
  // A fresh identity has no provider, so Sync carries a warning dot.
  await expect(page.getByTestId('manage-nav-sync-missing')).toBeVisible()
  await page.waitForTimeout(DEMO_BEAT_MS)

  await page.getByTestId('manage-nav-devices').click()
  await expect(page).toHaveURL(/\/identity\/devices$/)
  await expect(page.getByTestId('vault-devices-panel')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect(page.getByTestId('manage-nav-devices')).toHaveAttribute(
    'aria-current',
    'page',
  )
  await page.waitForTimeout(DEMO_BEAT_MS)

  // Phones move the rail to a bottom bar under the same page.
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(rail).toBeInViewport()
  await expect
    .poll(() =>
      page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      })),
    )
    .toEqual({ clientWidth: 390, scrollWidth: 390 })
  await page.waitForTimeout(DEMO_BEAT_MS)

  // Adding a device leads the rail on wide screens and returns to it.
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.getByTestId('manage-nav-add-device').click()
  await expect(page.getByTestId('add-device-page')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await page.getByTestId('add-device-back').click()
  await expect(page.getByTestId('vault-devices-panel')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
})
