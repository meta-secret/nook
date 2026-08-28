import { expect, test } from './fixtures'
import {
  authorizeDeviceProtection,
  connectLocalVault,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
} from './helpers'

type WorkspaceRoutingWindow = Window & {
  __nookWorkspaceRouteEventCount: number
}

test.describe('persistent workspace routing', () => {
  test('routes between primary pages', async ({ page }) => {
    await connectLocalVault(page)
    const initialHistoryLength = await page.evaluate(() => history.length)
    await page.evaluate(() => {
      const testWindow = window as WorkspaceRoutingWindow
      testWindow.__nookWorkspaceRouteEventCount = 0
      window.addEventListener('popstate', () => {
        testWindow.__nookWorkspaceRouteEventCount += 1
      })
    })

    await expect(page.getByTestId('vault-devices-access-tab')).toHaveCount(0)

    const headerDevicesAccess = page.getByTestId('header-devices-access-btn')
    await headerDevicesAccess.click()
    await expect(page).toHaveURL(/\/devices-access$/)
    await expect(page.getByTestId('devices-access-dashboard')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await page.getByTestId('devices-access-back').click()
    await expect(page).toHaveURL(/\/vault$/)
    await expect(headerDevicesAccess).toBeFocused()

    await page.getByTestId('vault-admin-tab').click()
    await expect(page).toHaveURL(/\/admin$/)
    await expect(page.getByTestId('vault-admin-panel')).toBeVisible()

    expect(await page.evaluate(() => history.length)).toBeGreaterThanOrEqual(
      initialHistoryLength + 1,
    )

    await page.getByTestId('vault-settings-tab').click()
    await expect(page).toHaveURL(/\/settings$/)
    await expect(page.getByTestId('storage-settings-panel')).toBeVisible()

    await page.getByTestId('help-open-btn').click()
    await expect(page).toHaveURL(/\/help$/)
    await expect(page.getByTestId('help-page')).toBeVisible()

    expect(await page.evaluate(() => history.length)).toBeGreaterThanOrEqual(
      initialHistoryLength + 3,
    )
    expect(
      await page.evaluate(
        () => (window as WorkspaceRoutingWindow).__nookWorkspaceRouteEventCount,
      ),
    ).toBeGreaterThanOrEqual(3)

    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(
            () => reject(new Error('popstate did not fire after history.back')),
            10_000,
          )
          window.addEventListener(
            'popstate',
            () => {
              window.clearTimeout(timeout)
              resolve()
            },
            { once: true },
          )
          history.back()
        }),
    )
    await expect(page).toHaveURL(/\/settings$/)
    await expect(page.getByTestId('storage-settings-panel')).toBeVisible()
    expect(new URL(page.url()).search).toBe('')
  })

  test('restores a locked Access deep link after authentication', async ({
    page,
  }) => {
    await connectLocalVault(page)
    await page.evaluate(() => {
      localStorage.setItem('nook_e2e_manual_passkey', 'true')
    })
    // Navigate the current canonical URL as a fresh document. Supplying the
    // deep-link target explicitly keeps Playwright from losing the SPA URL
    // while the locked WASM session tears down during reload.
    await page.goto('/devices-access')
    await expect(
      page.getByTestId('login-gate').getByTestId('devices-access-dashboard'),
    ).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
    await authorizeDeviceProtection(page)

    await expect(page.getByTestId('devices-access-dashboard')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(page).toHaveURL(/\/devices-access$/)
  })

  test('keeps authenticated access available without overflowing a narrow header', async ({
    page,
  }) => {
    await connectLocalVault(page)
    await page.setViewportSize({ width: 320, height: 844 })

    const headerDevicesAccess = page.getByTestId('header-devices-access-btn')
    await expect(headerDevicesAccess).toBeVisible()
    await expect(headerDevicesAccess).toBeInViewport()
    await expect(page.getByTestId('header-lock-vault-btn')).toBeInViewport()
    await expect(page.getByTestId('header-language-select')).toBeHidden()
    await expect(page.getByTestId('theme-toggle-btn')).toBeHidden()
    await expect(page.getByTestId('help-open-btn')).toBeHidden()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(320)

    await headerDevicesAccess.click()
    await expect(page.getByTestId('devices-access-dashboard')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
  })

  test('does not queue header access while the workspace is not mounted', async ({
    page,
  }) => {
    await connectLocalVault(page)

    for (const route of ['/logs', '/extension-connect']) {
      await page.evaluate((path) => {
        history.pushState({}, '', path)
        window.dispatchEvent(new PopStateEvent('popstate'))
      }, route)

      await expect(page).toHaveURL(route)
      await expect(page.getByTestId('header-devices-access-btn')).toHaveCount(0)
      await page.getByTestId('legal-header-back').click()

      await expect(page).toHaveURL(/\/vault$/)
      await expect(page.getByTestId('vault-panel')).toBeVisible()
      await expect(page.getByTestId('header-devices-access-btn')).toBeVisible()
    }
  })

  test('leaves an active secret draft cleanly before opening header access', async ({
    page,
  }) => {
    await connectLocalVault(page)
    await page.getByTestId('add-secret-btn').click()
    await page.getByTestId('item-type-login').click()
    await page.getByTestId('secret-label').fill('Unsaved draft')
    await page.getByTestId('login-username').fill('draft@example.com')
    await expect(page.getByTestId('authenticated-shell')).toHaveClass(
      /authenticated-shell-editor/,
    )

    await page.getByTestId('header-devices-access-btn').click()
    await expect(page.getByTestId('devices-access-dashboard')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await page.getByTestId('devices-access-back').click()

    await expect(page.getByTestId('vault-panel')).toBeVisible()
    await expect(page.getByTestId('add-secret-panel')).toHaveCount(0)
    await expect(page.getByTestId('authenticated-shell')).not.toHaveClass(
      /authenticated-shell-editor/,
    )
    await expect(page.getByTestId('secret-label')).toHaveCount(0)
    await expect(page.getByTestId('login-username')).toHaveCount(0)
  })

  test('applies a direct workspace route after authentication', async ({
    page,
  }) => {
    await connectLocalVault(page)
    await page.goto('/onboard?sensitive=discarded#private-state')
    await authorizeDeviceProtection(page)

    await expect(page.getByTestId('onboard-device-panel')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(page).toHaveURL(/\/onboard$/)
    expect(new URL(page.url()).search).toBe('')
    expect(new URL(page.url()).hash).toBe('')

    await page.getByTestId('vault-secrets-tab').click()
    await expect(page.getByTestId('vault-panel')).toBeVisible()
    await expect(page).toHaveURL(/\/vault$/)
  })
})
