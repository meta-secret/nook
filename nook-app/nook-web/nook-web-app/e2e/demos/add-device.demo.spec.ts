import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import {
  clearBrowserVault,
  connectLocalVault,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  forceVaultQuiescentForE2e,
  ManagePage,
  openIdentitiesPage,
  openManagePage,
  openVaultPage,
  seedSyncProvidersWhileUnlocked,
  UI_TIMEOUT_MS,
} from '../helpers'

const DEMO_BEAT_MS = 700

async function demoBeat(page: Page) {
  await page.waitForTimeout(DEMO_BEAT_MS)
}

async function snapshot(page: Page, name: string) {
  const directory = process.env.NOOK_DEMO_SCREENSHOT_DIR
  if (!directory) return
  await page.screenshot({ path: `${directory}/${name}.png`, fullPage: true })
}

test('adding a device starts from the identity card and walks three steps', async ({
  page,
}) => {
  await page.goto('/app/')
  await clearBrowserVault(page)
  await page.reload()
  await connectLocalVault(page)

  // The unlocked identity's card offers adding a device.
  await openIdentitiesPage(page)
  const addDevice = page.getByTestId('identity-add-device')
  await expect(addDevice).toBeVisible({ timeout: UI_TIMEOUT_MS })
  await snapshot(page, '1-hub-card')
  await demoBeat(page)

  // Without a cloud copy, step one asks for a sync provider first.
  await addDevice.click()
  await expect(page).toHaveURL(/\/identity\/devices\/add$/)
  await expect(page.getByTestId('add-device-page')).toBeVisible()
  await expect(page.getByTestId('onboard-no-identity-mount')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect(page.getByTestId('onboard-device-panel')).toHaveCount(0)
  await snapshot(page, '2-needs-cloud')
  await demoBeat(page)

  // With a provider, the invite is one click: provider and passphrase are
  // already chosen.
  await page.getByTestId('add-device-back').click()
  await openVaultPage(page)
  await seedSyncProvidersWhileUnlocked(page)
  await forceVaultQuiescentForE2e(page)
  await openIdentitiesPage(page)
  await page.getByTestId('identity-add-device').click()
  await expect(page.getByTestId('add-device-cloud-ready')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  const create = page.getByTestId('onboard-device-submit')
  await expect(create).toBeEnabled({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  await snapshot(page, '3-ready-to-invite')
  await demoBeat(page)

  await create.click()
  await expect(page.getByTestId('onboard-link')).toContainText('#enroll=', {
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect(page.getByTestId('onboard-passphrase-display')).toBeVisible()
  await expect(page.getByTestId('add-device-waiting')).toBeVisible()
  await snapshot(page, '4-invite')
  await demoBeat(page)

  // Back returns to the hub it was opened from.
  await page.getByTestId('add-device-back').click()
  await expect(page.getByTestId('identities-hub')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })

  // The Devices page leads with the same action.
  await openManagePage(page, ManagePage.Devices)
  await expect(page.getByTestId('devices-add-device-btn')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await snapshot(page, '5-devices-page')
})
