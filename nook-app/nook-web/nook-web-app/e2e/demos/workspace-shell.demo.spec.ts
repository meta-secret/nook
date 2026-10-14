import { expect, test } from '../fixtures'
import {
  clearBrowserVault,
  connectLocalVault,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  UI_TIMEOUT_MS,
} from '../helpers'

const DEMO_BEAT_MS = 700

test('one workspace sheet carries the rail, the page and the setup band', async ({
  page,
}) => {
  await page.goto('/app/')
  await clearBrowserVault(page)
  await page.reload()
  await connectLocalVault(page)
  await expect(page.getByTestId('vault-panel')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })

  // The rail lists the open vault's pages and the identity's pages at once.
  const rail = page.getByTestId('manage-nav')
  await expect(rail).toBeVisible()
  for (const item of ['items', 'passwords', 'import', 'keys', 'devices']) {
    await expect(page.getByTestId(`manage-nav-${item}`)).toBeVisible()
  }
  await expect(page.getByTestId('manage-nav-items')).toHaveAttribute(
    'aria-current',
    'page',
  )
  // A fresh identity has no provider, so Sync carries a warning dot.
  await expect(page.getByTestId('manage-nav-sync-missing')).toBeVisible()

  // Setup sits in one band at the top of the vault page.
  const setup = page.getByTestId('vault-setup-band')
  await expect(setup).toBeVisible()
  await expect(setup.getByTestId('vault-security-guide')).toBeVisible()
  await expect(page.getByTestId('vault-import-btn')).toHaveCount(0)
  await expect(page.getByTestId('vault-manage-btn')).toHaveCount(0)
  await page.waitForTimeout(DEMO_BEAT_MS)

  // Identity pages open in the same sheet; the rail stays in place.
  await page.getByTestId('manage-nav-devices').click()
  await expect(page).toHaveURL(/\/identity\/devices$/)
  await expect(page.getByTestId('vault-devices-panel')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect(page.getByTestId('manage-nav-devices')).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(rail).toBeVisible()
  await page.waitForTimeout(DEMO_BEAT_MS)

  await page.getByTestId('manage-nav-items').click()
  await expect(page).toHaveURL(/\/vault$/)
  await expect(page.getByTestId('vault-panel')).toBeVisible()

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

  // The identity entry leads back to the hub on wide screens.
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.getByTestId('manage-nav-identities').click()
  await expect(page.getByTestId('identities-hub')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
})
