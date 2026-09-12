import { DeviceProtectionStatus } from '$app-wasm'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { connectLocalVault, installPasskeyMock } from './helpers'

test.describe('devices and access identity cancellation', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('nook_e2e_manual_passkey', 'true')
    })
    await installPasskeyMock(page)
    await connectLocalVault(page)
    await page.getByTestId('header-devices-access-btn').click()
    await page.getByTestId('devices-access-add-identity').click()
    await expect(
      page.getByTestId('devices-access-add-identity-flow'),
    ).toBeVisible()
  })

  async function identityCreationPending(page: Page): Promise<boolean> {
    const pending = await page.evaluate(() => {
      const vault = window.__nookVault
      if (!vault)
        return { ok: false as const, error: 'Vault runtime is not exposed' }
      const manager = vault.admitManager()
      return manager.isErr()
        ? { ok: false as const, error: manager.error.translationKey }
        : {
            ok: true as const,
            value: manager.value.local_identity_creation_pending,
          }
    })
    if (!pending.ok) throw new Error(pending.error)
    return pending.value
  }

  async function deviceProtectionVerifying(page: Page): Promise<boolean> {
    return page.evaluate(() => {
      const vault = window.__nookVault
      if (!vault) {
        throw new Error('Vault runtime is not exposed')
      }
      return vault.isVerifying
    })
  }

  test('restores the unlocked identity after leaving PIN fallback', async ({
    page,
  }) => {
    await page.evaluate(() => {
      localStorage.setItem('nook_e2e_passkey_mode', 'unavailable')
    })
    await page.getByTestId('device-protection-setup-btn').click()
    await expect(page.getByTestId('device-protection-pin-input')).toBeVisible()

    await page.getByTestId('devices-access-back').click()

    await expect(page.getByTestId('devices-access-dashboard')).toHaveCount(0)
    await expect.poll(() => deviceProtectionVerifying(page)).toBe(false)
    await expect.poll(() => identityCreationPending(page)).toBe(false)
    expect(
      await page.evaluate(() => {
        if (!('__nookVault' in window)) {
          throw new Error('Vault runtime is not exposed')
        }
        return window.__nookVault?.deviceProtectionStatus
      }),
    ).toBe(DeviceProtectionStatus.Unlocked)
  })

  test('clears a failed setup intent after navigation', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('nook_e2e_passkey_mode', 'delayed-cancel')
    })
    await page.getByTestId('device-protection-setup-btn').click()

    await page.getByTestId('devices-access-back').click()

    await expect(page.getByTestId('devices-access-dashboard')).toHaveCount(0)
    await expect.poll(() => deviceProtectionVerifying(page)).toBe(false)
    await expect.poll(() => identityCreationPending(page)).toBe(false)
    await page.getByTestId('header-devices-access-btn').click()
    await expect(
      page.getByTestId('devices-access-identity-option'),
    ).toHaveCount(1)
  })
})
