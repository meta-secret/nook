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

test('the identity control page leads to adding a device in three steps', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/app/')
  await clearBrowserVault(page)
  await page.reload()
  await connectLocalVault(page)

  // The hub card names what the identity lacks; its chip opens the control
  // page.
  await openIdentitiesPage(page)
  const health = page.getByTestId('identity-card-health')
  await expect(health).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  await snapshot(page, '1-hub-health')
  await health.click()
  await expect(page.getByTestId('identity-overview')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await snapshot(page, '2-control-page')
  await demoBeat(page)

  // Without a cloud copy, adding a device asks for a sync provider first.
  await page.getByTestId('overview-add-device').click()
  await expect(page).toHaveURL(/\/identity\/devices\/add$/)
  await expect(page.getByTestId('onboard-no-identity-mount')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect(page.getByTestId('onboard-device-panel')).toHaveCount(0)
  await snapshot(page, '3-needs-cloud')
  await demoBeat(page)

  // With a provider, the ladder's next step is a second device.
  await page.getByTestId('add-device-back').click()
  await expect(page.getByTestId('identity-overview')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await openVaultPage(page)
  await seedSyncProvidersWhileUnlocked(page)
  await forceVaultQuiescentForE2e(page)
  await openIdentitiesPage(page)
  await page.getByTestId('identity-card-health').click()
  const nextStep = page.getByTestId('overview-next-step-btn')
  await expect(page.getByTestId('overview-next-step')).toHaveAttribute(
    'data-next-step',
    'AddDevice',
    { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
  )
  await nextStep.click()
  await expect(page.getByTestId('add-device-stage')).toHaveAttribute(
    'data-stage',
    'invite',
    { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
  )
  const create = page.getByTestId('onboard-device-submit')
  await expect(create).toBeEnabled({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  await snapshot(page, '4-ready-to-invite')
  await demoBeat(page)

  await create.click()
  await expect(page.getByTestId('onboard-link')).toContainText('#enroll=', {
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect(page.getByTestId('onboard-passphrase-display')).toBeVisible()
  await expect(page.getByTestId('add-device-waiting')).toBeVisible()
  await snapshot(page, '5-invite')
  await demoBeat(page)

  // Back returns to the control page; Devices open in place.
  await page.getByTestId('add-device-back').click()
  await expect(page.getByTestId('identity-overview')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await page.getByTestId('overview-open-devices').click()
  await expect(page).toHaveURL(/\/identity\/devices$/)
  await expect(page.getByTestId('overview-panel')).toBeVisible()
  await expect(page.getByTestId('devices-add-device-btn')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await snapshot(page, '6-devices-open')
  const directory = process.env.NOOK_DEMO_SCREENSHOT_DIR
  if (directory) {
    await page
      .getByTestId('overview-panel')
      .screenshot({ path: `${directory}/6b-devices-panel.png` })
  }
  await demoBeat(page)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByTestId('overview-panel-close').click()
  await expect(page.getByTestId('overview-panel')).toHaveCount(0)
  await snapshot(page, '7-control-page-phone')
})
