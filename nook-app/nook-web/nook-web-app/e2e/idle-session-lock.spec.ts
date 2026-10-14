import { expect, test } from './fixtures'
import {
  authorizeDeviceProtection,
  clearBrowserVault,
  connectLocalVault,
  disableLoginAutoUnlock,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  UI_TIMEOUT_MS,
  unlockVaultOnLogin,
  waitForPersistedAppLog,
  waitForVaultOperationsIdle,
} from './helpers'

/** Matches playwright.config.ts — fast idle lock for e2e only. */
const IDLE_LOCK_MS = Number(
  ((...[v = '2500']) => v)(process.env.VITE_VAULT_IDLE_TIMEOUT_MS),
)

test.describe('idle session auto-lock', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/app/')
    await clearBrowserVault(page)
    await page.reload()
    await connectLocalVault(page)
    await disableLoginAutoUnlock(page)
    await page.reload()
  })

  test('locks after inactivity and allows unlock again', async ({ page }) => {
    await expect(page.getByTestId('identity-vault-row').first()).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await unlockVaultOnLogin(page)
    await expect(page.getByTestId('authenticated-shell')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await waitForVaultOperationsIdle(page)

    await page.waitForTimeout(IDLE_LOCK_MS + 1500)

    await expect(page.getByTestId('login-session-expired')).toBeVisible()
    await expect(page.getByTestId('identity-vault-row').first()).toBeVisible()

    await waitForPersistedAppLog(page, {
      scope: 'vault-session',
      level: 'info',
      messageIncludes: 'vault locked',
    })

    await authorizeDeviceProtection(page)
    await expect(page.getByTestId('authenticated-shell')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(page.getByTestId('login-session-expired')).not.toBeVisible()

    await waitForPersistedAppLog(page, {
      scope: 'vault-session',
      level: 'info',
      messageIncludes: 'vault session unlocked',
    })
  })

  test('user activity resets the idle timer', async ({ page }) => {
    await expect(page.getByTestId('identity-vault-row').first()).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await unlockVaultOnLogin(page)
    await expect(page.getByTestId('authenticated-shell')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })

    const bumpInterval = Math.max(500, Math.floor(IDLE_LOCK_MS / 2))
    for (let i = 0; i < 3; i += 1) {
      await page.waitForTimeout(bumpInterval)
      // The page title is inert; the shell's corner is the workspace rail.
      await page.getByTestId('page-bar-title').click({
        position: { x: 4 + i * 4, y: 4 },
      })
    }

    await expect(page.getByTestId('authenticated-shell')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
    await expect(page.getByTestId('login-gate')).not.toBeVisible()
  })
})
