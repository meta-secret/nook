import { expect, test } from '../fixtures'
import {
  addVaultPassword,
  connectLocalVault,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  installPasskeyMock,
} from '../helpers'

const BEAT_MS = 650

test('walk the access chain from passkey to browser device key to vaults', async ({
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
  await expect(page.getByTestId('devices-access-identity-state')).toContainText(
    'Identity unlocked',
  )
  const chain = page.getByTestId('devices-access-chain')
  await expect(chain).toContainText('Device evidence')
  await expect(chain).toContainText('Local identity state')
  await expect(chain).toContainText('Verified device-key access')
  await expect(page.getByTestId('devices-access-strength-vaults')).toHaveCount(
    1,
  )
  await page.waitForTimeout(BEAT_MS)

  const panel = page.getByTestId('devices-access-panel')
  await page
    .getByTestId('devices-access-provider-label')
    .fill('Apple Passwords on personal devices')
  await page.getByTestId('devices-access-provider-save').click()
  await expect(page.getByTestId('devices-access-provider-label')).toHaveValue(
    'Apple Passwords on personal devices',
  )
  await page.waitForTimeout(BEAT_MS)

  await page.getByTestId('devices-access-browser-reported').click()
  await expect(panel).toContainText('Backed up or synced')
  await page.waitForTimeout(BEAT_MS)

  await page.getByTestId('devices-access-node-device-key').click()
  await expect(panel).toContainText('Browser device key')
  await expect(panel).toContainText('A backup password is different')
  await page.waitForTimeout(BEAT_MS)

  await page.getByTestId('devices-access-node-vaults').click()
  await expect(
    page.getByTestId('devices-access-strength-vaults'),
  ).toContainText('Verified way in')
  await expect(page.getByTestId('devices-access-vaults')).toContainText(
    'Access verified',
  )
  await expect(page.getByTestId('devices-access-current-vault')).toContainText(
    'Travel recovery',
  )
  await page.waitForTimeout(BEAT_MS)

  await page.getByTestId('devices-access-perspective-vaults').click()
  await expect(
    page.getByRole('heading', {
      name: /Verified device-key access to Test vault: 1/,
    }),
  ).toBeVisible()
  await expect(chain).toContainText('Selected vault')
  await expect(chain).toContainText('Device evidence')
  await page.waitForTimeout(BEAT_MS)

  await page.getByTestId('header-lock-vault-btn').click()
  await page.getByTestId('login-devices-access').click()
  await expect(page.getByTestId('devices-access-identity-state')).toContainText(
    'Identity locked',
  )
  await page.getByTestId('devices-access-node-vaults').click()
  await expect(page.getByTestId('devices-access-vaults')).toContainText(
    'Access verified',
  )
  await expect(page.getByTestId('devices-access-current-vault')).toHaveCount(0)
  await page.waitForTimeout(BEAT_MS)
})
