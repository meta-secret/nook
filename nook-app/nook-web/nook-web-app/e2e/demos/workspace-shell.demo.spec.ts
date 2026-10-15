import { expect, test } from '../fixtures'
import {
  clearBrowserVault,
  connectLocalVault,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  UI_TIMEOUT_MS,
} from '../helpers'

const DEMO_BEAT_MS = 700

test('the vault page holds items; the identity has one control page', async ({
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
  await expect(page.getByTestId('identity-overview')).toHaveCount(0)
  await page.waitForTimeout(DEMO_BEAT_MS)

  // Manage on the identity card opens its control page: the ladder with
  // the next step, then the parts, each opening in place.
  await page.getByTestId('header-identities-btn').click()
  await page.getByTestId('identity-manage').first().click()
  await expect(page).toHaveURL(/\/identity$/)
  await expect(page.getByTestId('identity-overview')).toBeVisible()
  // A fresh identity has no provider, so its next step is a sync provider.
  await expect(page.getByTestId('overview-next-step')).toHaveAttribute(
    'data-next-step',
    'AddSyncProvider',
  )
  for (const opener of [
    'overview-open-vaults',
    'overview-open-sync',
    'overview-open-devices',
    'overview-keys',
    'overview-passwords',
    'overview-browser-settings',
  ]) {
    await expect(page.getByTestId(opener)).toBeVisible()
  }
  await page.waitForTimeout(DEMO_BEAT_MS)

  const devices = page.getByTestId('overview-open-devices')
  await devices.click()
  await expect(page).toHaveURL(/\/identity\/devices$/)
  await expect(page.getByTestId('vault-devices-panel')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect(devices).toHaveAttribute('aria-expanded', 'true')
  await page.waitForTimeout(DEMO_BEAT_MS)

  // Phones stack the same page without sideways scrolling.
  await page.setViewportSize({ width: 390, height: 844 })
  await expect
    .poll(() =>
      page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      })),
    )
    .toEqual({ clientWidth: 390, scrollWidth: 390 })
  await page.waitForTimeout(DEMO_BEAT_MS)

  // Adding a device leads the Devices part and returns to it.
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.getByTestId('devices-add-device-btn').click()
  await expect(page.getByTestId('add-device-page')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await page.getByTestId('add-device-back').click()
  await expect(page.getByTestId('vault-devices-panel')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
})
