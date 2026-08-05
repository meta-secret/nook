import { expect, test } from '../fixtures'
import {
  addVaultPassword,
  connectLocalVault,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  installPasskeyMock,
} from '../helpers'

const BEAT_MS = 650

test('inspect independent identity, protection, and vault access evidence', async ({
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
  await expect(page.getByTestId('devices-access-identity-card')).toBeVisible()
  const chain = page.getByTestId('devices-access-chain')
  await expect(chain).toContainText('Local identity state')
  await expect(chain).not.toContainText('Passkey')
  await expect(chain).not.toContainText('Device key')
  await expect(chain.locator('.svelte-flow__edge')).toHaveCount(0)
  await page.setViewportSize({ width: 240, height: 844 })
  await expect
    .poll(() =>
      chain.evaluate((element) => {
        const identity = element.querySelector(
          '[data-testid="devices-access-identity-card"]',
        )
        if (!(identity instanceof HTMLElement)) return false

        const bridgeBounds = element.getBoundingClientRect()
        const identityBounds = identity.getBoundingClientRect()
        return (
          identityBounds.left >= bridgeBounds.left &&
          identityBounds.right <= bridgeBounds.right
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

  await page.getByTestId('devices-access-node-vaults').click()
  await expect(panel).toContainText('Vault access evidence')
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
      name: 'Local access to Test vault',
    }),
  ).toBeVisible()
  await expect(chain).toContainText('Selected vault')
  await expect(chain).toContainText('Verified way in')
  await expect(chain).not.toContainText('Device key')
  await page.waitForTimeout(BEAT_MS)

  await page.getByTestId('header-lock-vault-btn').click()
  await page.getByTestId('login-devices-access').click()
  await expect(page.getByTestId('devices-access-identity-card')).toBeVisible()
  await page.getByTestId('devices-access-node-vaults').click()
  await expect(page.getByTestId('devices-access-vaults')).toContainText(
    'Access verified',
  )
  await expect(page.getByTestId('devices-access-current-vault')).toHaveCount(0)
  await page.waitForTimeout(BEAT_MS)
})
