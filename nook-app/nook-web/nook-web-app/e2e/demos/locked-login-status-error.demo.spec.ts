import { SentinelVaultUnlockState } from '$app-wasm'
import type { VaultState } from '$lib/vault.svelte'
import { expect, test } from '../fixtures'
import { clearBrowserVault, connectLocalVault, UI_TIMEOUT_MS } from '../helpers'

declare global {
  interface Window {
    readonly __nookVault?: VaultState
  }
}

type SentinelStatusCycle = {
  readonly unlocked: SentinelVaultUnlockState
  readonly locked: SentinelVaultUnlockState
}

test('keeps the create workflow usable after locked-login Sentinel status errors', async ({
  page,
}) => {
  await page.goto('/app/')
  await clearBrowserVault(page)
  await page.reload()
  await connectLocalVault(page)

  await page.getByTestId('header-lock-vault-btn').click()
  await expect(page.getByTestId('login-gate')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })
  await expect(page.getByTestId('login-local-unlock-step')).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  })

  await page.evaluate(
    async (statuses: SentinelStatusCycle) => {
      const vault = window.__nookVault
      if (!vault) throw new Error('__nookVault is unavailable')
      const manager = vault.admitManager().match(
        (admittedManager) => admittedManager,
        () => {
          throw new Error('Local vault manager is unavailable')
        },
      )
      const originalStatusReader = manager.sentinel_unlock_status.bind(manager)
      manager.sentinel_unlock_status = () => {
        throw new Error('Demo Sentinel status read failure')
      }

      vault.sentinelUnlockStatus = statuses.unlocked
      await new Promise<number>((resolve) =>
        window.requestAnimationFrame(resolve),
      )
      vault.sentinelUnlockStatus = statuses.locked
      await new Promise<number>((resolve) =>
        window.requestAnimationFrame(resolve),
      )
      vault.sentinelUnlockStatus = statuses.unlocked
      await new Promise<number>((resolve) =>
        window.requestAnimationFrame(resolve),
      )
      vault.sentinelUnlockStatus = statuses.locked
      await new Promise<number>((resolve) =>
        window.requestAnimationFrame(resolve),
      )

      manager.sentinel_unlock_status = originalStatusReader
    },
    {
      unlocked: SentinelVaultUnlockState.Unlocked,
      locked: SentinelVaultUnlockState.NotSentinel,
    },
  )

  const vaultError = page.getByTestId('vault-error')
  await expect(vaultError).toBeVisible({ timeout: UI_TIMEOUT_MS })
  await page.getByTestId('login-vault-workflow-create').click()

  await expect(page.getByTestId('login-vault-create-workflow')).toBeVisible()
  const vaultNameInput = page.getByTestId('login-vault-name-input')
  await expect(vaultNameInput).toBeVisible()
  await expect(vaultNameInput).toBeEnabled()
  await vaultNameInput.fill('Locked login recovery')
  await expect(vaultNameInput).toHaveValue('Locked login recovery')
  await expect(vaultError).toBeVisible()
  await page.waitForTimeout(700)
  await expect(vaultNameInput).toBeEnabled()
  await expect(vaultError).toBeVisible()
})
