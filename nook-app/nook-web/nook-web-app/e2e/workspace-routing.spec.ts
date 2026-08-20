import { expect, type Page, test } from './fixtures'
import {
  authorizeDeviceProtection,
  connectLocalVault,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
} from './helpers'

async function traverseWorkspaceHistoryBack(page: Page) {
  await page.evaluate(() => {
    setTimeout(() => window.history.back(), 0)
  })
}

test.describe('persistent workspace routing', () => {
  test('keeps primary pages in browser history', async ({ page }) => {
    await connectLocalVault(page)

    await page.getByTestId('vault-devices-access-tab').click()
    await expect(page).toHaveURL(/\/devices-access$/)
    await expect(page.getByTestId('devices-access-dashboard')).toBeVisible()

    await page.getByTestId('vault-admin-tab').click()
    await expect(page).toHaveURL(/\/admin$/)
    await expect(page.getByTestId('vault-admin-panel')).toBeVisible()

    await traverseWorkspaceHistoryBack(page)
    await expect(page).toHaveURL(/\/devices-access$/)
    await expect(page.getByTestId('devices-access-dashboard')).toBeVisible()

    await page.getByTestId('vault-settings-tab').click()
    await expect(page).toHaveURL(/\/settings$/)
    await expect(page.getByTestId('storage-settings-panel')).toBeVisible()

    await page.getByTestId('help-open-btn').click()
    await expect(page).toHaveURL(/\/help$/)
    await expect(page.getByTestId('help-page')).toBeVisible()

    await traverseWorkspaceHistoryBack(page)
    await expect(page).toHaveURL(/\/settings$/)
    await expect(page.getByTestId('storage-settings-panel')).toBeVisible()
    expect(new URL(page.url()).search).toBe('')
  })

  test('applies a direct workspace route after authentication', async ({
    page,
  }) => {
    await connectLocalVault(page)
    await page.goto('/onboard?sensitive=discarded#private-state')
    await authorizeDeviceProtection(page)

    await expect(page.getByTestId('onboard-device-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(page).toHaveURL(/\/onboard$/)
    expect(new URL(page.url()).search).toBe('')
    expect(new URL(page.url()).hash).toBe('')

    await page.getByTestId('vault-secrets-tab').click()
    await expect(page.getByTestId('vault-panel')).toBeVisible()
    await expect(page).toHaveURL(/\/vault$/)
  })
})
