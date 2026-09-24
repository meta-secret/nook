import { UnlockMethod } from '$lib/components/login/login-unlock-state'
import { expect, test } from '../fixtures'
import {
  addVaultPassword,
  clearBrowserVault,
  connectLocalVault,
  disableLoginAutoUnlock,
  openStorageSettings,
  selectLoginUnlockMethod,
  UI_TIMEOUT_MS,
} from '../helpers'

const DEMO_BEAT_MS = 700

test('shows backup-password unlock after locked local-vault startup', async ({
  page,
}) => {
  await page.goto('/app/')
  await clearBrowserVault(page)
  await page.reload()
  await connectLocalVault(page)

  await openStorageSettings(page)
  await addVaultPassword(page, 'Startup recovery', 'startup-recovery-password')

  await page.getByTestId('header-lock-vault-btn').click()
  await expect(page.getByTestId('login-local-unlock-step')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await disableLoginAutoUnlock(page)
  await page.reload()

  await expect(page.getByTestId('login-gate')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await expect(page.getByTestId('login-local-unlock-step')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await expect(page.getByTestId('vault-error')).not.toBeVisible()

  await page.evaluate(async () => {
    const vault = window.__nookVault
    if (!vault) {
      throw new Error('__nookVault is unavailable')
    }
    const admittedManager = vault.admitManager()
    if (admittedManager.isErr()) {
      throw new Error('Local vault manager is unavailable')
    }
    const manager = admittedManager.value
    const fetchPasswordEntries =
      manager.fetch_vault_password_entries.bind(manager)
    vault.localLoginPreparation = 'idle' as typeof vault.localLoginPreparation
    manager.fetch_vault_password_entries = async () => {
      manager.fetch_vault_password_entries = fetchPasswordEntries
      throw new Error('Demo transient metadata fetch failure')
    }
    await vault.prepareLocalLogin()
    if (String(vault.localLoginPreparation) !== 'idle') {
      throw new Error('Failed metadata preparation did not return to idle')
    }
  })
  const vaultError = page.getByTestId('vault-error')
  await expect(vaultError).toBeVisible({ timeout: UI_TIMEOUT_MS })
  await page.waitForTimeout(DEMO_BEAT_MS)

  const retryPreparation = await page.evaluate(async () => {
    const vault = window.__nookVault
    if (!vault) {
      throw new Error('__nookVault is unavailable')
    }
    await vault.prepareLocalLogin()
    return String(vault.localLoginPreparation)
  })
  expect(retryPreparation).toBe('ready')
  await expect(vaultError).not.toBeVisible()

  await selectLoginUnlockMethod(page, UnlockMethod.Password)
  const passwordEntries = page.getByTestId('login-password-entry-list')
  await expect(passwordEntries).toBeVisible({ timeout: UI_TIMEOUT_MS })
  await expect(
    passwordEntries.getByRole('button', { name: 'Startup recovery' }),
  ).toBeVisible()
  await expect(page.getByTestId('login-password-input')).toBeVisible()
  await expect(page.getByTestId('passkey-auth-overlay')).toBeHidden()
  await expect(vaultError).not.toBeVisible()
  await page.waitForTimeout(DEMO_BEAT_MS)
})
