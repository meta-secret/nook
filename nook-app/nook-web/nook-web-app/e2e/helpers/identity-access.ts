import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { ENROLLMENT_UNLOCK_TIMEOUT_MS } from './environment'

export async function prepareTwoProtectedIdentitiesWithoutVault(
  page: Page,
): Promise<void> {
  await page.goto('/app/')
  await page.getByTestId('login-devices-access').click()
  await page.getByTestId('devices-access-add-identity').click()
  await page
    .getByTestId('device-protection-label-input')
    .fill('Personal identity passkey')
  await page.getByTestId('device-protection-setup-btn').click()
  await expect(page.getByTestId('devices-access-key-inventory')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })

  await page.getByTestId('devices-access-add-identity').click()
  await page.evaluate(() => {
    localStorage.setItem('nook_e2e_passkey_mode', 'unavailable')
  })
  await page
    .getByTestId('device-protection-label-input')
    .fill('Work identity passkey')
  await page.getByTestId('device-protection-setup-btn').click()
  await expect(page.getByTestId('device-protection-pin-input')).toBeVisible()
  await page.getByTestId('device-protection-pin-input').fill('246810')
  await page.getByTestId('device-protection-pin-confirm').fill('246810')
  await page.getByTestId('device-protection-pin-setup-btn').click()
  await page.evaluate(() => {
    localStorage.removeItem('nook_e2e_passkey_mode')
  })
  await expect(page.getByTestId('devices-access-identity-option')).toHaveCount(
    2,
    { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
  )
}
