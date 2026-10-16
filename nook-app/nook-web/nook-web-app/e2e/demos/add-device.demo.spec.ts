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

  // The hub card offers its protection checklist; Manage lists its pages,
  // adding a device first.
  await openIdentitiesPage(page)
  await expect(page.getByTestId('identity-protection-toggle')).toContainText(
    '0 of 2 done',
    { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
  )
  await snapshot(page, '1-hub-health')
  await page.getByTestId('identity-manage').first().click()
  await expect(page.getByTestId('identity-menu')).toBeVisible()
  await snapshot(page, '2-manage-menu')
  await demoBeat(page)

  // Without a cloud copy, Manage leads with a sync provider and holds adding
  // a device until one exists.
  const addDeviceItem = page.getByTestId('identity-menu-add-device')
  await expect(addDeviceItem).toBeDisabled()
  await expect(addDeviceItem).toContainText('Add a cloud sync provider first')
  await expect(
    page.getByTestId('identity-menu').getByRole('menuitem').first(),
  ).toHaveAttribute('data-testid', 'identity-menu-sync')
  await snapshot(page, '3-needs-cloud')
  await demoBeat(page)

  // With a cloud copy and one device, the card's protection checklist
  // offers a second device.
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
  const protection = page.getByTestId('identity-protection-toggle')
  await expect(protection).toContainText('1 of 2 done', {
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await protection.click()
  await expect(page.getByTestId('identity-protection-risk')).toContainText(
    'only this device can open it',
  )
  await snapshot(page, '4-hub-one-device')
  await page.getByTestId('identity-protection-action').click()
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
  // The invite carries the vault keys: the new device joins by itself, so
  // this one neither approves it nor waits for it.
  const stage = page.getByTestId('add-device-stage')
  await expect(stage).toHaveAttribute('data-stage', 'issued')
  await expect(stage).toContainText('It joins by itself.')
  await expect(stage).not.toContainText('Approve')
  await expect(stage).not.toContainText('Waiting')
  await expect(page.getByTestId('add-device-progress')).not.toContainText(
    'Join',
  )
  await expect(page.getByTestId('add-device-done')).toBeVisible()
  await snapshot(page, '6-invite')
  await demoBeat(page)

  // Identity details lists what the identity has; Devices opens from it.
  // Back sits on the hero's title row and returns to the identities hub.
  await expect(
    page
      .getByTestId('add-device-page')
      .locator('header')
      .getByTestId('add-device-back'),
  ).toBeVisible()
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
  await expect(page.getByTestId('vault-devices-panel')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  // The page's Back shares the row with its title.
  await expect(
    page
      .getByTestId('identity-page')
      .locator('header')
      .getByTestId('identity-page-back'),
  ).toBeVisible()
  await snapshot(page, '7-devices-page')
  await demoBeat(page)

  // Back returns to the details; on a phone its tiles stack.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByTestId('identity-page-back').click()
  await expect(page.getByTestId('identity-overview')).toBeVisible()
  await snapshot(page, '8-details-phone')
})
