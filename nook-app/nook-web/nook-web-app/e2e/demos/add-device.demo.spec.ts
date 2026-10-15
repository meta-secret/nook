import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures'
import {
  clearBrowserVault,
  connectLocalVault,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  forceVaultQuiescentForE2e,
  openIdentitiesPage,
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

test('the identity card leads to adding a device in three steps', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/app/')
  await clearBrowserVault(page)
  await page.reload()
  await connectLocalVault(page)

  // The hub card names what the identity lacks; Manage lists its pages,
  // adding a device first.
  await openIdentitiesPage(page)
  await expect(page.getByTestId('identity-card-health')).toContainText(
    'No cloud copy yet',
    { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
  )
  await snapshot(page, '1-hub-health')
  await page.getByTestId('identity-manage').first().click()
  await expect(page.getByTestId('identity-menu')).toBeVisible()
  await snapshot(page, '2-manage-menu')
  await demoBeat(page)

  // Without a cloud copy, adding a device asks for a sync provider first.
  await page.getByTestId('identity-menu-add-device').click()
  await expect(page).toHaveURL(/\/identity\/devices\/add$/)
  await expect(page.getByTestId('onboard-no-identity-mount')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect(page.getByTestId('onboard-device-panel')).toHaveCount(0)
  await snapshot(page, '3-needs-cloud')
  await demoBeat(page)

  // With a cloud copy and one device, the card offers a second device.
  await page.getByTestId('add-device-back').click()
  await expect(page.getByTestId('identities-hub')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await page.getByTestId('identity-overview-toggle').first().click()
  await expect(page.getByTestId('identity-overview')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect(page.getByTestId('overview-open-sync')).toBeVisible()
  await snapshot(page, '3b-details-no-cloud')
  await openVaultPage(page)
  await seedSyncProvidersWhileUnlocked(page)
  await forceVaultQuiescentForE2e(page)
  await openIdentitiesPage(page)
  await expect(page.getByTestId('identity-card-health')).toContainText(
    'Only one device',
    { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
  )
  const addDevice = page.getByTestId('identity-add-device')
  await expect(addDevice).toBeVisible()
  await snapshot(page, '4-hub-one-device')
  await addDevice.click()
  await expect(page.getByTestId('add-device-stage')).toHaveAttribute(
    'data-stage',
    'invite',
    { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
  )
  const create = page.getByTestId('onboard-device-submit')
  await expect(create).toBeEnabled({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  await snapshot(page, '5-ready-to-invite')
  await demoBeat(page)

  await create.click()
  await expect(page.getByTestId('onboard-link')).toContainText('#enroll=', {
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect(page.getByTestId('onboard-passphrase-display')).toBeVisible()
  await expect(page.getByTestId('add-device-waiting')).toBeVisible()
  await snapshot(page, '6-invite')
  await demoBeat(page)

  // Identity details lists what the identity has; Devices opens from it.
  await page.getByTestId('add-device-back').click()
  await expect(page.getByTestId('identities-hub')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await page.getByTestId('identity-overview-toggle').first().click()
  await expect(page.getByTestId('identity-overview')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await snapshot(page, '7a-identity-details')
  await page.getByTestId('overview-open-devices').click()
  await expect(page).toHaveURL(/\/identity\/devices$/)
  await expect(page.getByTestId('devices-add-device-btn')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await snapshot(page, '7-devices-page')
  await demoBeat(page)

  // Back returns to the details; on a phone its tiles stack.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByTestId('identity-page-back').click()
  await expect(page.getByTestId('identity-overview')).toBeVisible()
  await snapshot(page, '8-details-phone')
})
