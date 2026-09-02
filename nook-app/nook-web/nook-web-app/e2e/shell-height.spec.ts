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
    const vaultHeight = ((v) => (v ? v : 0))(
      (await shell.boundingBox())?.height,
    )
    expect(vaultHeight).toBeGreaterThan(0)

    await page.getByTestId('vault-admin-tab').click()
    await expect(page.getByTestId('vault-admin-panel')).toBeVisible()
    const adminHeight = ((v) => (v ? v : 0))(
      (await shell.boundingBox())?.height,
    )
    expect(adminHeight).toBeCloseTo(vaultHeight, 0)

    await page.getByTestId('vault-onboard-tab').click()
    await expect(page.getByTestId('onboard-device-panel')).toBeVisible()
    const onboardHeight = ((v) => (v ? v : 0))(
      (await shell.boundingBox())?.height,
    )
    expect(onboardHeight).toBeCloseTo(vaultHeight, 0)

    await page.getByTestId('vault-settings-tab').click()
    await expect(page.getByTestId('vault-devices-section')).toBeVisible()
    await expect(page.getByTestId('extension-setup-settings')).toBeVisible()
    await expect(page.getByTestId('extension-setup-settings')).toHaveAttribute(
      'data-status',
      'not_installed',
    )
    await expect(page.getByTestId('extension-setup-settings-cta')).toBeVisible()
    const settingsHeight = ((v) => (v ? v : 0))(
      (await shell.boundingBox())?.height,
    )
    expect(settingsHeight).toBeCloseTo(vaultHeight, 0)

    await page.getByTestId('vault-secrets-tab').click()
    await expect(page.getByTestId('vault-panel')).toBeVisible()
    const vaultAgainHeight = ((v) => (v ? v : 0))(
      (await shell.boundingBox())?.height,
    )
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
      'pan-y pinch-zoom',
    )

    const mobileToolsTrigger = page.getByTestId('header-mobile-tools-btn')
    await expect(mobileToolsTrigger).toBeVisible()
    await expect(mobileToolsTrigger).toBeInViewport()
    await mobileToolsTrigger.click()

    const mobileTools = page.getByTestId('header-mobile-tools')
    await expect(mobileTools).toBeVisible()

    for (const testId of [
      'header-language-select',
      'header-mobile-theme-toggle-btn',
      'header-mobile-lock-vault-btn',
    ]) {
      const control = mobileTools.getByTestId(testId)
      await expect(control).toBeVisible()
      await expect(control).toBeInViewport()
    }
  })

  test('keeps every expanded security recommendation reachable in a short viewport', async ({
    page,
  }) => {
    const viewport = { width: 1280, height: 600 }
    await page.setViewportSize(viewport)
    await page.getByTestId('security-guide-toggle').click()

    const shellScroll = page.locator('.shell-scroll')
    const scrollRange = await shellScroll.evaluate(
      (element) => element.scrollHeight - element.clientHeight,
    )
    expect(scrollRange).toBeGreaterThan(0)

    const addDevice = page.getByTestId('security-guide-add-device')
    await addDevice.scrollIntoViewIfNeeded()
    await expect(addDevice).toBeInViewport()
    await expect
      .poll(() => shellScroll.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0)
    await expect(page.getByTestId('vault-bottom-nav')).toBeInViewport()
  })

  test('keeps secure-note editing and navigation usable above the mobile keyboard', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByTestId('add-secret-btn').click()
    await page.getByTestId('item-type-secure-note').click()

    await expect(page.getByTestId('vault-bottom-nav')).toBeVisible()
    await expect(page.getByTestId('extension-install-setup')).toHaveCount(0)
    await expect(page.getByTestId('add-secret-cancel-btn')).toBeInViewport()
    await expect(page.getByTestId('save-secret-btn')).toBeInViewport()

    await page.getByTestId('vault-secrets-tab').click()
    await expect(page.getByTestId('add-secret-panel')).toHaveCount(0)
    await page.getByTestId('add-secret-btn').click()
    await page.getByTestId('item-type-secure-note').click()

    await page.getByTestId('secret-label').fill('Mobile note')
    await page.getByTestId('secret-value').focus()
    await page.setViewportSize({ width: 390, height: 500 })

    await page.getByTestId('markdown-editor').scrollIntoViewIfNeeded()
    await expect(page.getByTestId('extension-install-setup')).toHaveCount(0)
    await expect(page.getByTestId('markdown-editor')).toBeInViewport()
    await expect(page.getByTestId('vault-bottom-nav')).toBeInViewport()
    await expect
      .poll(() =>
        page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        })),
      )
      .toEqual({ clientWidth: 390, scrollWidth: 390 })

    await page.getByTestId('vault-admin-tab').click()
    await expect(page.getByTestId('vault-admin-panel')).toBeVisible()
    await page.getByTestId('vault-secrets-tab').click()
    await expect(page.getByTestId('vault-panel')).toBeVisible()
    await expect(page.getByTestId('add-secret-panel')).toHaveCount(0)
  })
})
