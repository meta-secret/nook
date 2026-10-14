import { expect, test } from '../fixtures'
import {
  connectLocalVault,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  ManagePage,
  openManagePage,
} from '../helpers'

const DEMO_BEAT_MS = 700

test('the overview reads the identity as vaults, sync, and devices', async ({
  page,
}) => {
  await connectLocalVault(page)
  await openManagePage(page, ManagePage.Overview)

  const overview = page.getByTestId('identity-overview')
  await expect(overview).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  await expect(page.getByTestId('overview-ladder')).toBeVisible()
  await expect(page.getByTestId('overview-next-step')).toHaveAttribute(
    'data-next-step',
    'AddSyncProvider',
  )
  await expect(page.getByTestId('overview-count-vaults')).toHaveText('1')
  await expect(page.getByTestId('overview-count-sync')).toHaveText('0')
  // A second device waits for a cloud provider to carry the identity.
  await expect(page.getByTestId('overview-add-device')).toBeDisabled()
  await page.waitForTimeout(DEMO_BEAT_MS)

  await page.getByTestId('overview-security').scrollIntoViewIfNeeded()
  await expect(page.getByTestId('overview-keys')).toBeVisible()
  await page.waitForTimeout(DEMO_BEAT_MS)

  await page.getByTestId('overview-next-step-btn').click()
  await expect(page).toHaveURL(/\/identity\/sync$/)
  await expect(page.getByTestId('storage-providers-section')).toBeVisible()
  await page.waitForTimeout(DEMO_BEAT_MS)
})
