import { expect, test } from '../fixtures'
import {
  clearBrowserVault,
  connectLocalVault,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  UI_TIMEOUT_MS,
} from '../helpers'

const DEMO_BEAT_MS = 700

test('the vault page holds items; the identity card manages the rest', async ({
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
  await expect(page.getByTestId('identity-menu')).toHaveCount(0)
  await page.waitForTimeout(DEMO_BEAT_MS)

  // Manage on the identity card holds actions, adding a device first;
  // a fresh identity also names what it lacks.
  await page.getByTestId('header-identities-btn').click()
  await expect(page.getByTestId('identity-card-health')).toContainText(
    'No cloud copy yet',
  )
  await page.getByTestId('identity-manage').first().click()
  const menu = page.getByTestId('identity-menu')
  await expect(menu).toBeVisible()
  for (const item of ['add-device', 'sync', 'passwords']) {
    await expect(page.getByTestId(`identity-menu-${item}`)).toBeVisible()
  }
  await page.waitForTimeout(DEMO_BEAT_MS)

  // Overview opens beside the card: devices, cloud copies, vaults and
  // sign-in, each tile opening its page.
  await page.getByTestId('identity-overview-toggle').first().click()
  await expect(page.getByTestId('identity-overview')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await page.getByTestId('overview-open-devices').first().click()
  await expect(page).toHaveURL(/\/identity\/devices$/)
  await expect(page.getByTestId('vault-devices-panel')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await page.waitForTimeout(DEMO_BEAT_MS)

  await page.getByTestId('identity-page-back').click()
  await expect(page.getByTestId('identity-overview')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
})
