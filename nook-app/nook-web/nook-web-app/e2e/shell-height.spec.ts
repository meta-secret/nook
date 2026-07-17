import { expect, test } from './fixtures'
import { clearBrowserVault, connectLocalVault, UI_TIMEOUT_MS } from './helpers'

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

  test('keeps the mobile vault fixed to the horizontal viewport', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })

    await expect
      .poll(() =>
        page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        })),
      )
      .toEqual({ clientWidth: 390, scrollWidth: 390 })

    await page.evaluate(() => window.scrollTo({ left: 100, top: 0 }))
    await expect.poll(() => page.evaluate(() => window.scrollX)).toBe(0)
    await expect(page.getByTestId('authenticated-shell')).toHaveCSS(
      'touch-action',
      'pan-y',
    )
  })
})
