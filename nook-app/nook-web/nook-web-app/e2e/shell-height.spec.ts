import { expect, test } from './fixtures'
import {
  clearBrowserVault,
  connectLocalVault,
  UI_TIMEOUT_MS,
} from './helpers'

test.describe('authenticated shell height', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/app/')
    await clearBrowserVault(page)
    await page.reload()
    await connectLocalVault(page)
    await expect(page.getByTestId('authenticated-shell')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
  })

  test('keeps consistent height when switching Vault / Admin / Onboard / Settings tabs', async ({
    page,
  }) => {
    const shell = page.getByTestId('authenticated-shell')

    await expect(page.getByTestId('vault-panel')).toBeVisible()
    const vaultHeight = (await shell.boundingBox())?.height ?? 0
    expect(vaultHeight).toBeGreaterThan(0)

    await page.getByTestId('vault-admin-tab').click()
    await expect(page.getByTestId('vault-admin-panel')).toBeVisible()
    const adminHeight = (await shell.boundingBox())?.height ?? 0
    expect(adminHeight).toBeCloseTo(vaultHeight, 0)

    await page.getByTestId('vault-onboard-tab').click()
    await expect(page.getByTestId('onboard-device-panel')).toBeVisible()
    const onboardHeight = (await shell.boundingBox())?.height ?? 0
    expect(onboardHeight).toBeCloseTo(vaultHeight, 0)

    await page.getByTestId('vault-settings-tab').click()
    await expect(page.getByTestId('vault-devices-section')).toBeVisible()
    const settingsHeight = (await shell.boundingBox())?.height ?? 0
    expect(settingsHeight).toBeCloseTo(vaultHeight, 0)

    await page.getByTestId('vault-secrets-tab').click()
    await expect(page.getByTestId('vault-panel')).toBeVisible()
    const vaultAgainHeight = (await shell.boundingBox())?.height ?? 0
    expect(vaultAgainHeight).toBeCloseTo(vaultHeight, 0)
  })
})
