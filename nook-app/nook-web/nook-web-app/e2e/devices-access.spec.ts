import { expect, test } from './fixtures'
import {
  addVaultPassword,
  connectLocalVault,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  installPasskeyMock,
} from './helpers'

test.describe('devices and access dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('nook_e2e_manual_passkey', 'true')
    })
    await installPasskeyMock(page)
  })

  test('is available before any vault and lets the suggestion stay dismissed', async ({
    page,
  }) => {
    await page.goto('/app/')

    await expect(page.getByTestId('devices-access-nudge')).toBeVisible()
    await page.getByTestId('devices-access-dont-show-again').check()
    await expect(page.getByTestId('devices-access-nudge')).toBeHidden()

    await page.getByTestId('login-devices-access').click()
    const dashboard = page.getByTestId('devices-access-dashboard')
    await expect(dashboard).toBeVisible()
    await expect(dashboard).toContainText('Not prepared')
    await expect(
      page.getByTestId('devices-access-prepare-browser'),
    ).toBeVisible()
    await expect(dashboard).toContainText('No local vaults yet')

    await page.reload()
    await expect(page.getByTestId('devices-access-nudge')).toHaveCount(0)
    await expect(page.getByTestId('login-devices-access')).toBeVisible()
  })

  test('shows observed passkey metadata, verified vault access, and unlocked vault context', async ({
    page,
  }) => {
    await connectLocalVault(page)
    await addVaultPassword(
      page,
      'Emergency recovery',
      'correct horse battery staple',
    )

    await page.getByTestId('vault-devices-access-tab').click()
    const dashboard = page.getByTestId('devices-access-dashboard')
    await expect(dashboard).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(dashboard).toContainText('Passkey · recoverable identity')
    await expect(dashboard).toContainText('Access verified')
    await expect(
      page.getByTestId('devices-access-current-vault'),
    ).toContainText('Emergency recovery')

    await page
      .getByTestId('devices-access-provider-label')
      .fill('Bitwarden family vault')
    await page.getByTestId('devices-access-provider-save').click()
    await expect(page.getByTestId('devices-access-provider-label')).toHaveValue(
      'Bitwarden family vault',
    )

    await dashboard
      .getByText('Technical details and browser observations')
      .click()
    await expect(dashboard).toContainText('Built into this platform')
    await expect(dashboard).toContainText('Backed up or synced')
    await expect(dashboard).toContainText('hybrid, internal')
    await expect(dashboard).toContainText(
      '01010101-0101-0101-0101-010101010101',
    )

    await page.getByTestId('header-lock-vault-btn').click()
    await page.getByTestId('login-devices-access').click()
    await expect(page.getByTestId('devices-access-dashboard')).toContainText(
      'Access verified',
    )
    await expect(page.getByTestId('devices-access-current-vault')).toHaveCount(
      0,
    )
  })
})
