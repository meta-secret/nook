import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import {
  clearBrowserVault,
  connectLocalVault,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  openOpenVaultPanel,
  UI_TIMEOUT_MS,
} from './helpers'

/** Click "Unlock with passkey" while the passkey prompt stays open, and
 * check the page-level device sheet never shows; then let the prompt
 * finish and the vault open in place. */
async function unlockWhilePromptIsOpen(page: Page): Promise<void> {
  const unlock = page.getByTestId('vault-panel-unlock')
  await expect(unlock).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
  await page.evaluate(() => {
    localStorage.setItem('nook_e2e_passkey_mode', 'hold')
  })
  await unlock.click()
  // A real prompt waits for Touch ID; the sheet must not open meanwhile.
  await page.waitForTimeout(1_000)
  await expect(page.getByTestId('passkey-auth-overlay')).toHaveCount(0)
  await page.evaluate(() => {
    localStorage.removeItem('nook_e2e_passkey_mode')
  })
  await expect(page.getByTestId('vault-panel-beside')).toHaveAttribute(
    'data-state',
    'open',
    { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
  )
  await expect(page.getByTestId('passkey-auth-overlay')).toHaveCount(0)
}

test.describe('unlocking a vault from its card', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/app/')
    await clearBrowserVault(page)
    await page.reload()
    await connectLocalVault(page)
    await openOpenVaultPanel(page)
  })

  test('keeps the passkey prompt on the card after a lock', async ({
    page,
  }) => {
    await page.getByTestId('identity-lock').click()
    // Locking folds the card to its header and vaults: the vault's own row
    // opens its panel, which asks for the passkey.
    const row = page.getByTestId('identity-vault-row').first()
    await expect(row).toHaveAttribute('aria-expanded', 'false', {
      timeout: UI_TIMEOUT_MS,
    })
    await row.click()
    await unlockWhilePromptIsOpen(page)
  })

  test('reopens the vault on its card after a reload, with no page sheet', async ({
    page,
  }) => {
    await page.reload()
    // The identity was never locked, so it opens again by itself; its vault's
    // row then opens the vault in place on the card, with no prompt.
    const row = page.getByTestId('identity-vault-row').first()
    await expect(row).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
    if ((await row.getAttribute('aria-expanded')) !== 'true') {
      await expect(row).toBeEnabled({ timeout: UI_TIMEOUT_MS })
      await row.click()
    }
    await expect(page.getByTestId('vault-panel-beside')).toHaveAttribute(
      'data-state',
      'open',
      { timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS },
    )
    await expect(page.getByTestId('vault-panel-open')).toBeVisible()
    await expect(page.getByTestId('passkey-auth-overlay')).toHaveCount(0)
  })
})
