import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  addVaultPassword,
  clearBrowserVault,
  connectLocalVault,
  disableVaultIdleLock,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  expandSettingsSection,
  expectFirstVaultOpen,
  expectVaultPasswordStatus,
  openIdentitiesPage,
  openStorageSettings,
  startFirstRun,
  UI_TIMEOUT_MS,
} from './helpers'

/** Run one check on the access check page and wait for its card. */
async function runCheck(page: Page, cards: number) {
  await page.getByTestId('access-check-run').click()
  await expect(page.getByTestId('access-check-credential')).toHaveCount(cards, {
    timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
  })
}

test.describe('check access', () => {
  test('the identity passkey proves it opens its vault, read-only', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem('nook_e2e_manual_passkey', 'true')
    })
    await page.goto('/app/')
    await expect(page.getByTestId('first-vault-start')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await startFirstRun(page)
    const createChoice = page.getByTestId('device-protection-create-new-choice')
    if (await createChoice.isVisible()) await createChoice.click()
    const setup = page.getByTestId('device-protection-setup-btn')
    await expect(setup).toBeEnabled({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
    await setup.click()
    await expectFirstVaultOpen(page, 'Passkey vault')
    await disableVaultIdleLock(page)

    await openIdentitiesPage(page)
    await page.getByTestId('access-check-open-btn').click()
    await expect(page.getByTestId('access-check-page')).toBeVisible()
    await runCheck(page, 1)

    // The passkey opens this browser's identity, and with it its vault.
    const identity = page.getByTestId('access-check-identity')
    await expect(identity).toHaveCount(1)
    await expect(identity.getByTestId('access-check-vault')).toContainText(
      'Passkey vault',
    )
    await expect(identity).toHaveAttribute('data-outcome', 'opens')

    // Back leaves the check without having changed anything.
    await page.getByTestId('access-check-back-btn').click()
    await expect(page.getByTestId('access-check-page')).toHaveCount(0)
    await expect(page.getByTestId('identities-hub')).toBeVisible()
  })

  test('a backup password opens its vault and a wrong one does not', async ({
    page,
  }) => {
    await page.goto('/app/')
    await clearBrowserVault(page)
    await page.reload()
    await connectLocalVault(page)
    await openStorageSettings(page)
    await expandSettingsSection(page, 'unlock')
    await addVaultPassword(page, 'Primary password', 'correct-horse-1')
    await expectVaultPasswordStatus(page, 1, { timeout: UI_TIMEOUT_MS })

    // Check access sits with the keyrings, on the keyrings page.
    await openIdentitiesPage(page)
    await page.getByTestId('access-check-open-btn').click()
    await page.getByTestId('access-check-method-password').click()
    await expect(page.getByTestId('access-check-run')).toBeDisabled()

    await page.getByTestId('access-check-password').fill('not-the-password')
    await runCheck(page, 1)
    await page.getByTestId('access-check-password').fill('correct-horse-1')
    await runCheck(page, 2)

    // One card per check: the wrong password, then the right one, which
    // opens the vault but never the keyring itself.
    await expect(page.getByTestId('access-check-identity')).toHaveCount(2)
    const outcomes = await page
      .getByTestId('access-check-identity')
      .evaluateAll((rows) =>
        rows.map((row) => row.getAttribute('data-outcome')),
      )
    expect(outcomes).toEqual(['doesNotOpen', 'vaultsOnly'])
  })

  test('opens from the first-run screen before any identity exists', async ({
    page,
  }) => {
    await page.goto('/app/')
    await clearBrowserVault(page)
    await page.reload()
    await expect(page.getByTestId('first-vault-start')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })

    await page.getByTestId('login-access-check-link').click()
    await expect(page.getByTestId('access-check-page')).toBeVisible()
    await expect(page).toHaveURL(/\/access-check$/)
    await page.getByTestId('access-check-method-password').click()
    await page.getByTestId('access-check-password').fill('anything-at-all')
    await runCheck(page, 1)
    await expect(page.getByTestId('access-check-empty')).toBeVisible()

    await page.getByTestId('access-check-back-btn').click()
    await expect(page.getByTestId('first-vault-start')).toBeVisible()
  })
})
