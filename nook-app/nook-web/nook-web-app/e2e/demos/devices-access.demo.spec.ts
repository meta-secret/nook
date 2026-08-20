import { expect, test } from '../fixtures'
import {
  addVaultPassword,
  connectLocalVault,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  installPasskeyMock,
} from '../helpers'

const BEAT_MS = 650

test('walk the access chain from passkey to app key to vaults', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('nook_e2e_manual_passkey', 'true')
  })
  await installPasskeyMock(page)
  await connectLocalVault(page)
  await addVaultPassword(page, 'Travel recovery', 'demo recovery passphrase')

  await page.getByTestId('vault-devices-access-tab').click()
  await expect(page).toHaveURL(/\/devices-access$/)
  const dashboard = page.getByTestId('devices-access-dashboard')
  await expect(dashboard).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  await expect(page.getByTestId('devices-access-identity-state')).toContainText(
    'Identity unlocked',
  )
  const chain = page.getByTestId('devices-access-chain')
  await expect(chain).toContainText('App key')
  await expect(chain).toContainText('Identity')
  await expect(chain).toContainText('Vaults')
  await page.getByTestId('devices-access-layout-list').click()
  const identityKeys = page.getByTestId('devices-access-identity-keys')
  await expect(identityKeys).toBeVisible()
  await expect(
    page.getByTestId('devices-access-key-card').first(),
  ).toBeVisible()
  await expect(identityKeys).toContainText('Passkey')
  await expect(identityKeys).not.toContainText('App key')
  await page.getByTestId('devices-access-layout-graph').click()
  await expect(chain).toBeVisible()
  await expect(page.getByTestId('devices-access-strength-vaults')).toHaveCount(
    1,
  )
  await page.setViewportSize({ width: 240, height: 844 })
  await expect
    .poll(() =>
      chain.evaluate((element) => {
        const protection = element.querySelector(
          'article[aria-label*="Passkey"]',
        )
        if (!(protection instanceof HTMLElement)) return false

        const bridgeBounds = element.getBoundingClientRect()
        const protectionBounds = protection.getBoundingClientRect()
        return (
          protectionBounds.left >= bridgeBounds.left &&
          protectionBounds.right <= bridgeBounds.right
        )
      }),
    )
    .toBe(true)
  await page.setViewportSize({ width: 1280, height: 720 })
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

  const unlockTab = page.getByTestId('devices-access-node-unlock')
  const deviceKeyTab = page.getByTestId('devices-access-node-device-key')
  await unlockTab.focus()
  await unlockTab.press('ArrowRight')
  await expect(deviceKeyTab).toHaveAttribute('aria-selected', 'true')
  await expect(panel).toContainText('App key')
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
      name: /Verified identity access to Test vault: 1/,
    }),
  ).toBeVisible()
  await expect(chain).toContainText('Selected vault')
  await expect(chain).toContainText('App key')
  await page.waitForTimeout(BEAT_MS)

  await page.getByTestId('header-lock-vault-btn').click()
  // Locking from /devices-access keeps that URL, so login opens Access directly.
  await expect(page).toHaveURL(/\/devices-access$/)
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
