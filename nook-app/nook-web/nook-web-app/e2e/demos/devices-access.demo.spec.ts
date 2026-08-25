import { expect, test } from '../fixtures'
import {
  addVaultPassword,
  connectLocalVault,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  installPasskeyMock,
} from '../helpers'

const BEAT_MS = 650

test('walk the access chain from passkey to app to vaults', async ({
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
  const identityRail = page.getByTestId('devices-access-identity-rail')
  const identityOptions = page.getByTestId('devices-access-identity-option')
  const keyInventory = page.getByTestId('devices-access-key-inventory')
  const keyRows = page.getByTestId('devices-access-key-row')
  await expect(identityRail).toBeVisible()
  await expect(identityOptions).toHaveCount(1)
  await expect(identityOptions).toHaveAttribute('data-selected', 'true')
  await expect(keyInventory).toBeVisible()
  await expect(keyRows).toHaveCount(1)
  await expect(keyRows.nth(0)).toHaveAttribute('data-kind', 'protector')
  await expect(page.getByTestId('devices-access-app')).toHaveCount(1)
  await expect(keyInventory).toContainText('Passkey')
  await expect(keyInventory).toContainText('Apps')
  await expect(keyInventory).toContainText('Nook in this browser')
  await expect(page.getByTestId('devices-access-app-id')).not.toBeVisible()
  await expect(
    page.getByTestId('devices-access-relationship-details'),
  ).toHaveCount(0)

  await expect(page.getByTestId('devices-access-add-identity')).toBeEnabled()
  await page.getByTestId('devices-access-add-identity').click()
  await expect(
    page.getByTestId('devices-access-add-identity-flow'),
  ).toBeVisible()
  await page.waitForTimeout(BEAT_MS)
  await page.getByTestId('devices-access-cancel-add-identity').click()
  await expect(keyInventory).toBeVisible()
  await page.waitForTimeout(BEAT_MS)

  await page.getByTestId('devices-access-layout-graph').click()
  await expect(keyInventory).toHaveCount(0)
  await expect(page.getByTestId('devices-access-identity-state')).toContainText(
    'Identity unlocked',
  )
  const browse = page.getByRole('navigation', { name: 'Browse by' })
  await expect(
    browse.getByRole('button', { name: 'Identity', exact: true }),
  ).toHaveCount(1)
  await expect(
    browse.getByRole('button', { name: 'Vault', exact: true }),
  ).toHaveCount(1)
  await expect(browse.getByRole('list')).toHaveCount(0)
  const chain = page.getByTestId('devices-access-chain')
  await expect(chain).toContainText('App')
  await expect(chain).toContainText('Identity')
  await expect(chain).toContainText('Vaults')
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

  await page.getByTestId('devices-access-layout-list').click()
  await page.getByTestId('devices-access-rename-passkey').click()
  await page
    .getByTestId('devices-access-passkey-name-input')
    .fill('Personal devices passkey')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(keyInventory).toContainText('Personal devices passkey')
  await page.waitForTimeout(BEAT_MS)

  await page.getByTestId('devices-access-layout-graph').click()
  await expect(
    chain.getByRole('article', {
      name: /Passkey: Passkey · recoverable identity/,
    }),
  ).toBeVisible()
  await expect(chain.getByRole('article', { name: /App: App/ })).toBeVisible()
  await page.waitForTimeout(BEAT_MS)

  await expect(
    page.getByTestId('devices-access-strength-vaults'),
  ).toContainText('Verified way in')
  await page.waitForTimeout(BEAT_MS)

  await page.getByTestId('devices-access-perspective-vaults').click()
  await expect(
    page.getByRole('heading', {
      name: /Verified identity access to Test vault: 1/,
    }),
  ).toBeVisible()
  await expect(chain).toContainText('Selected vault')
  await expect(chain).toContainText('App')
  await page.waitForTimeout(BEAT_MS)

  await page.getByTestId('header-lock-vault-btn').click()
  // Locking from /devices-access keeps that URL, so login opens Access directly.
  await expect(page).toHaveURL(/\/devices-access$/)
  await page.goto('/devices-access')
  await expect(page.getByTestId('devices-access-dashboard')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await page.getByTestId('devices-access-layout-graph').click()
  await expect(page.getByTestId('devices-access-identity-state')).toContainText(
    'Identity locked',
  )
  await expect(
    page.getByTestId('devices-access-strength-vaults'),
  ).toContainText('Verified way in')
  await page.waitForTimeout(BEAT_MS)
})
