import { expect, test } from '../fixtures'
import {
  addVaultPassword,
  connectLocalVault,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  installPasskeyMock,
} from '../helpers'

const BEAT_MS = 650

test('explain browser identity, passkey evidence, and vault relationships', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('nook_e2e_manual_passkey', 'true')
  })
  await installPasskeyMock(page)
  await connectLocalVault(page)
  await addVaultPassword(page, 'Travel recovery', 'demo recovery passphrase')

  await page.getByTestId('vault-devices-access-tab').click()
  const dashboard = page.getByTestId('devices-access-dashboard')
  await expect(dashboard).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  await expect(dashboard).toContainText('Browser access chain')
  await page.waitForTimeout(BEAT_MS)

  await page
    .getByTestId('devices-access-provider-label')
    .fill('Apple Passwords on personal devices')
  await page.getByTestId('devices-access-provider-save').click()
  await expect(page.getByTestId('devices-access-provider-label')).toHaveValue(
    'Apple Passwords on personal devices',
  )
  await page.waitForTimeout(BEAT_MS)

  await dashboard
    .getByText('Technical details and browser observations')
    .click()
  await expect(dashboard).toContainText('Passkey credential fingerprint')
  await expect(dashboard).toContainText('Backed up or synced')
  await page.waitForTimeout(BEAT_MS)

  await expect(page.getByTestId('devices-access-vaults')).toContainText(
    'Access verified',
  )
  await expect(page.getByTestId('devices-access-current-vault')).toContainText(
    'Travel recovery',
  )
  await page.waitForTimeout(BEAT_MS)

  await page.getByTestId('header-lock-vault-btn').click()
  await page.getByTestId('login-devices-access').click()
  await expect(page.getByTestId('devices-access-dashboard')).toContainText(
    'Access verified',
  )
  await expect(page.getByTestId('devices-access-current-vault')).toHaveCount(0)
  await page.waitForTimeout(BEAT_MS)
})
