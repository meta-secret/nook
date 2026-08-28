import { expect, test } from '../fixtures'
import { UnlockMethod } from '$lib/components/login/login-unlock-state'
import {
  addVaultPassword,
  connectLocalVault,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  installPasskeyMock,
  prepareTwoProtectedIdentitiesWithoutVault,
  selectLoginUnlockMethod,
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

  await page.getByTestId('header-lock-vault-btn').click()
  await expect(page.getByTestId('login-local-vault-detected')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  const identityContext = page.getByTestId('login-vault-identity-context')
  await expect(
    identityContext.getByTestId('login-vault-linked-identities'),
  ).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  await expect(identityContext).toContainText('Current browser')
  await page.waitForTimeout(BEAT_MS)

  await selectLoginUnlockMethod(page, UnlockMethod.Password)
  await page
    .getByTestId('login-password-entry-list')
    .getByRole('button', { name: 'Travel recovery' })
    .click()
  await page
    .getByTestId('login-password-input')
    .fill('demo recovery passphrase')
  await page.getByTestId('unlock-vault-btn').click()
  await expect(page.getByTestId('vault-admin-panel')).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect(page.getByTestId('vault-devices-access-tab')).toHaveCount(0)
  await page.evaluate(() => {
    history.pushState(history.state, '', '/devices-access')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect(page).toHaveURL(/\/devices-access$/)
  const dashboard = page.getByTestId('devices-access-dashboard')
  await expect(dashboard).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  await page.getByTestId('devices-access-unlock-identity').click()
  await page.getByTestId('device-protection-unlock-btn').click()
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
  const appsGroup = page.getByTestId('devices-access-apps-group')
  const app = appsGroup.getByTestId('devices-access-app')
  await expect(app).toHaveCount(1)
  await expect(keyInventory).toContainText('Passkey')
  const listPasskeyFacts = page.getByTestId('devices-access-passkey-facts')
  const keeperFact = listPasskeyFacts.locator('[data-kind="keeper"]')
  const passkeyIdFact = listPasskeyFacts.locator('[data-kind="fingerprint"]')
  const supportingFacts = listPasskeyFacts.locator(
    '[data-priority="supporting"]',
  )
  await expect(keeperFact).toHaveAttribute('data-priority', 'primary')
  await expect(keeperFact).toContainText('Stored with')
  await expect(passkeyIdFact).toHaveAttribute('data-priority', 'secondary')
  await expect(passkeyIdFact).toContainText('Passkey ID')
  await expect(passkeyIdFact).toContainText('passkey_')
  await expect(supportingFacts).toHaveCount(2)
  await expect(listPasskeyFacts).toContainText('First recorded by Nook')
  await expect(listPasskeyFacts).toContainText('Last used')
  await expect(
    keyInventory.getByText('Passkey · recoverable identity', { exact: true }),
  ).toHaveCount(0)
  await expect(appsGroup).toContainText('Apps')
  await expect(app).toContainText('Nook in this browser')
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
  const graphPasskeyCard = page.getByTestId('devices-access-passkey-card')
  await expect(graphPasskeyCard).toContainText('Passkey ID')
  await expect(graphPasskeyCard).toContainText('passkey_')
  await expect(graphPasskeyCard).toContainText('Stored with')
  await expect(graphPasskeyCard).toContainText('First recorded by Nook')
  await expect(graphPasskeyCard).toContainText('Last used')
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
        const title = protection.querySelector('.node-heading strong')
        if (!(title instanceof HTMLElement)) return false
        return (
          protectionBounds.left >= bridgeBounds.left &&
          protectionBounds.right <= bridgeBounds.right &&
          title.scrollWidth <= title.clientWidth
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
  await expect(page.getByTestId('devices-access-passkey-card')).toContainText(
    'Personal devices passkey',
  )
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

test('switch protected identities before creating a vault', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('nook_e2e_manual_passkey', 'true')
  })
  await installPasskeyMock(page)
  await prepareTwoProtectedIdentitiesWithoutVault(page)

  const identityOptions = page.getByTestId('devices-access-identity-option')
  const personalIdentity = identityOptions.filter({ hasText: 'Identity 1' })
  await personalIdentity.click()
  await page.waitForTimeout(BEAT_MS)
  await page.getByTestId('devices-access-use-identity').click()

  const loginDashboard = page
    .getByTestId('login-gate')
    .getByTestId('devices-access-dashboard')
  await expect(loginDashboard).toBeVisible({
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect(
    loginDashboard.getByTestId('devices-access-identity-protection-flow'),
  ).toBeVisible()
  await page.waitForTimeout(BEAT_MS)

  await page.getByTestId('device-protection-unlock-btn').click()
  await expect(personalIdentity).toHaveAttribute('data-selected', 'true', {
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
  await expect(page.getByTestId('devices-access-key-inventory')).toBeVisible()
  await page.waitForTimeout(BEAT_MS)
})
