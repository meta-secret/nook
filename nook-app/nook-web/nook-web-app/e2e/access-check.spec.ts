import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  clearBrowserVault,
  disableVaultIdleLock,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  expectFirstVaultOpen,
  openIdentitiesPage,
  startFirstRun,
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
    await expect(page.getByTestId('vault-panel')).toBeVisible()
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

    await page.getByTestId('access-check-back-btn').click()
    await expect(page.getByTestId('first-vault-start')).toBeVisible()
  })
})
