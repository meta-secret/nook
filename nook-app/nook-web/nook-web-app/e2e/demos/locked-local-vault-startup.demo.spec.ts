import { LocalLoginPreparationState } from '$lib/vault/state/local-login-preparation-state'
import { expect, test } from '../fixtures'
import {
  addVaultPassword,
  clearBrowserVault,
  connectLocalVault,
  disableLoginAutoUnlock,
  openStorageSettings,
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
  await expect(page.getByTestId('login-gate')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await disableLoginAutoUnlock(page)
  await page.reload()

  await expect(page.getByTestId('login-gate')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await expect(page.getByTestId('identity-vault-row').first()).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await expect(page.getByTestId('vault-error')).not.toBeVisible()

  await page.evaluate(async (idlePreparation) => {
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
    vault.localLoginPreparation = idlePreparation
    manager.fetch_vault_password_entries = async () => {
      manager.fetch_vault_password_entries = fetchPasswordEntries
      throw new Error('Demo transient metadata fetch failure')
    }
    await vault.prepareLocalLogin()
    if (vault.localLoginPreparation !== idlePreparation) {
      throw new Error('Failed metadata preparation did not return to idle')
    }
  }, LocalLoginPreparationState.Idle)
  const vaultError = page.getByTestId('vault-error')
  await expect(vaultError).toBeVisible({ timeout: UI_TIMEOUT_MS })
  await page.waitForTimeout(DEMO_BEAT_MS)

  const retryPreparation = await page.evaluate(async (readyPreparation) => {
    const vault = window.__nookVault
    if (!vault) {
      throw new Error('__nookVault is unavailable')
    }
    await vault.prepareLocalLogin()
    if (vault.localLoginPreparation !== readyPreparation) {
      throw new Error('Local login preparation did not reach Ready')
    }
    return vault.localLoginPreparation
  }, LocalLoginPreparationState.Ready)
  expect(retryPreparation).toBe(LocalLoginPreparationState.Ready)
  await expect(vaultError).not.toBeVisible()

  await page.getByTestId('identity-vault-row').first().click()
  await expect(page.getByTestId('card-password-input')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await expect(page.getByTestId('passkey-auth-overlay')).toBeHidden()
  await expect(vaultError).not.toBeVisible()
  // The passphrase opens in the vault's panel beside the locked card.
  await expect(page.getByTestId('vault-panel-passphrase')).toBeVisible()
  await page.waitForTimeout(DEMO_BEAT_MS)
})
