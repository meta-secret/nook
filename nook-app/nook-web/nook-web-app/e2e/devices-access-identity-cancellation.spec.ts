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
    await page.getByTestId('vault-devices-access-tab').click()
    await page.getByTestId('devices-access-add-identity').click()
    await expect(
      page.getByTestId('devices-access-add-identity-flow'),
    ).toBeVisible()
  })

  async function identityCreationPending(page: Page): Promise<boolean> {
    return page.evaluate(() => {
      if (!('__nookVault' in window)) {
        throw new Error('Vault runtime is not exposed')
      }
      return (
        window as Window & {
          __nookVault: {
            requireManager(): {
              readonly local_identity_creation_pending: boolean
            }
          }
        }
      ).__nookVault.requireManager().local_identity_creation_pending
    })
  }

  async function deviceProtectionVerifying(page: Page): Promise<boolean> {
    return page.evaluate(() => {
      if (!('__nookVault' in window)) {
        throw new Error('Vault runtime is not exposed')
      }
      return (
        window as Window & {
          __nookVault: { readonly isVerifying: boolean }
        }
      ).__nookVault.isVerifying
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
        return (
          window as Window & {
            __nookVault: {
              readonly deviceProtectionStatus: number
            }
          }
        ).__nookVault.deviceProtectionStatus
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
    await page.getByTestId('vault-devices-access-tab').click()
    await expect(
      page.getByTestId('devices-access-identity-option'),
    ).toHaveCount(1)
  })
})
