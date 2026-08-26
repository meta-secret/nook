import { expect, test } from './fixtures'
import {
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  installPasskeyMock,
  prepareTwoProtectedIdentitiesWithoutVault,
} from './helpers'

test.describe('pre-vault identity access', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('nook_e2e_manual_passkey', 'true')
    })
    await installPasskeyMock(page)
  })

  test('follows browser Back and Forward while locked', async ({ page }) => {
    await page.goto('/app/')
    await page.getByTestId('login-devices-access').click()
    await expect(page).toHaveURL(/\/devices-access$/)
    await expect(page.getByTestId('devices-access-dashboard')).toBeVisible()

    await page.goBack()

    await expect(page).toHaveURL(/\/vault$/)
    await expect(page.getByTestId('devices-access-dashboard')).toHaveCount(0)
    await expect(page.getByTestId('login-devices-access')).toBeVisible()

    await page.goForward()

    await expect(page).toHaveURL(/\/devices-access$/)
    await expect(page.getByTestId('devices-access-dashboard')).toBeVisible()
  })

  test('keeps identity recovery available after cancel and Back', async ({
    page,
  }) => {
    await prepareTwoProtectedIdentitiesWithoutVault(page)

    const identityOptions = page.getByTestId('devices-access-identity-option')
    const personalIdentity = identityOptions.filter({ hasText: 'Identity 1' })
    await personalIdentity.click()
    await page.getByTestId('devices-access-use-identity').click()

    const loginDashboard = page
      .getByTestId('login-gate')
      .getByTestId('devices-access-dashboard')
    const protectionFlow = loginDashboard.getByTestId(
      'devices-access-identity-protection-flow',
    )
    await expect(loginDashboard).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(protectionFlow).toBeVisible()
    await expect(page.getByTestId('device-protection-unlock-btn')).toBeVisible()

    await protectionFlow
      .getByRole('button', { name: 'Cancel', exact: true })
      .click()
    await loginDashboard.getByTestId('devices-access-back').click()
    await expect(page).toHaveURL(/\/vault$/)
    await expect(page.getByTestId('login-devices-access')).toBeVisible()
    await page.getByTestId('login-devices-access').click()
    await expect(page).toHaveURL(/\/devices-access$/)
    await page.getByTestId('devices-access-unlock-identity').click()

    await page.getByTestId('device-protection-unlock-btn').click()
    await expect(personalIdentity).toHaveAttribute('data-selected', 'true', {
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(protectionFlow).toHaveCount(0)
    await expect(page.getByTestId('devices-access-key-inventory')).toBeVisible()
  })
})
