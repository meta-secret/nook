import { expect, test } from './fixtures'
import {
  authorizeDeviceProtection,
  connectLocalVault,
  ENROLLMENT_UNLOCK_TIMEOUT_MS,
  signedSentinelInvitation,
  openVaultPage,
  openKeysPage,
} from './helpers'

test.describe('persistent workspace routing', () => {
  test('routes between primary pages', async ({ page }) => {
    await connectLocalVault(page)
    const initialHistoryLength = await page.evaluate(() => history.length)
    await page.evaluate(() => {
      document.documentElement.dataset.workspaceRouteEventCount = '0'
      window.addEventListener('popstate', () => {
        const count = Number.parseInt(
          document.documentElement.dataset.workspaceRouteEventCount || '0',
          10,
        )
        document.documentElement.dataset.workspaceRouteEventCount = String(
          count + 1,
        )
      })
    })

    // Manage on the current identity's card holds actions and the way to
    // its details; each detail page has its own address and Back returns
    // to the details.
    await page.getByTestId('header-identities-btn').click()
    await expect(page).toHaveURL(/\/identities$/)
    await page.getByTestId('identity-manage').first().click()
    await page.getByTestId('identity-menu-details').click()
    await expect(page).toHaveURL(/\/identity$/)
    await expect(page.getByTestId('identity-overview')).toBeVisible()
    for (const [row, address, marker] of [
      ['overview-passwords', /\/identity\/passwords$/, 'vault-unlock-section'],
      ['overview-keys', /\/identity\/keys$/, 'identity-keys'],
      ['overview-open-devices', /\/identity\/devices$/, 'vault-devices-panel'],
      ['overview-open-sync', /\/identity\/sync$/, 'storage-providers-section'],
      ['overview-open-vaults', /\/identity\/vaults$/, 'vault-admin-panel'],
    ] as const) {
      await page.getByTestId(row).first().click()
      await expect(page).toHaveURL(address)
      await expect(page.getByTestId(marker)).toBeVisible({
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })
      await page.getByTestId('identity-page-back').click()
      await expect(page.getByTestId('identity-overview')).toBeVisible()
    }
    await page.getByTestId('identity-page-back').click()
    await expect(page.getByTestId('identities-hub')).toBeVisible()

    await page.getByTestId('header-identities-btn').click()
    await expect(page).toHaveURL(/\/identities$/)
    await expect(page.getByTestId('identities-hub')).toBeVisible()

    await page.getByTestId('help-open-btn').click()
    await expect(page).toHaveURL(/\/help$/)
    await expect(page.getByTestId('help-page')).toBeVisible()

    expect(await page.evaluate(() => history.length)).toBeGreaterThanOrEqual(
      initialHistoryLength + 5,
    )
    expect(
      await page.evaluate(() =>
        Number.parseInt(
          document.documentElement.dataset.workspaceRouteEventCount || '0',
          10,
        ),
      ),
    ).toBeGreaterThanOrEqual(5)

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
    await expect(page).toHaveURL(/\/identities$/)
    await expect(page.getByTestId('identities-hub')).toBeVisible()
    expect(new URL(page.url()).search).toBe('')
  })

  test('keeps earlier workspace paths working', async ({ page }) => {
    await connectLocalVault(page)
    for (const [legacy, current, marker] of [
      ['/admin', /\/identity\/vaults$/, 'vault-admin-vaults-section'],
      ['/onboard', /\/identity\/devices\/add$/, 'add-device-page'],
      ['/vault/devices', /\/identity\/devices$/, 'vault-devices-panel'],
      ['/vault/sync', /\/identity\/sync$/, 'storage-providers-section'],
      ['/settings', /\/identity\/settings$/, 'browser-settings-panel'],
    ] as const) {
      await page.evaluate((path) => {
        history.pushState({}, '', path)
        window.dispatchEvent(new PopStateEvent('popstate'))
      }, legacy)
      await expect(page.getByTestId(marker)).toBeVisible({
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })
      await page.reload()
      await authorizeDeviceProtection(page)
      await expect(page.getByTestId(marker)).toBeVisible({
        timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
      })
      await expect(page).toHaveURL(current)
    }
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
    await page.goto('/identity/keys')
    // A locked identity shows the hub; the URL is kept and unlocking resumes it.
    await expect(page.getByTestId('identities-hub')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(page).toHaveURL(/\/identity\/keys$/)
    await authorizeDeviceProtection(page)

    await expect(page.getByTestId('identity-keys')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(page).toHaveURL(/\/identity\/keys$/)
  })

  test('keeps authenticated access available without overflowing a narrow header', async ({
    page,
  }) => {
    await connectLocalVault(page)

    const headerIdentities = page.getByTestId('header-identities-btn')
    const mobileToolsButton = page.getByTestId('header-mobile-tools-btn')

    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 })

      await expect(headerIdentities).toBeVisible()
      await expect(headerIdentities).toBeInViewport()
      await expect(page.getByTestId('header-lock-vault-btn')).toBeHidden()
      await expect(page.getByTestId('header-language-select')).toBeHidden()
      await expect(page.getByTestId('theme-toggle-btn')).toBeHidden()
      await expect(page.getByTestId('help-open-btn')).toBeHidden()
      await expect(mobileToolsButton).toBeVisible()
      await mobileToolsButton.click()

      const mobileTools = page.getByTestId('header-mobile-tools')
      await expect(mobileTools).toBeVisible()
      await expect(
        mobileTools.getByTestId('header-language-select'),
      ).toBeVisible()
      await expect(
        mobileTools.getByTestId('header-mobile-theme-toggle-btn'),
      ).toBeVisible()
      await expect(
        mobileTools.getByTestId('header-mobile-help-open-btn'),
      ).toBeVisible()
      await expect(
        mobileTools.getByTestId('header-mobile-lock-vault-btn'),
      ).toBeVisible()
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width)

      await page.keyboard.press('Escape')
      await expect(mobileTools).toBeHidden()
      await expect(mobileToolsButton).toBeFocused()
    }

    await mobileToolsButton.click()
    await page.getByTestId('header-mobile-help-open-btn').click()
    await expect(page.getByTestId('help-page')).toBeVisible()
    await page.getByTestId('help-header-close').click()

    await headerIdentities.click()
    await expect(page.getByTestId('identities-hub')).toBeVisible({
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
      await expect(page.getByTestId('header-identities-btn')).toHaveCount(0)
      await expect(page.getByTestId('header-lock-vault-btn')).toBeVisible()
      await expect(page.getByTestId('header-lock-vault-btn')).toBeEnabled()

      await page.setViewportSize({ width: 320, height: 780 })
      await expect(page.getByTestId('header-mobile-tools-btn')).toBeVisible()
      await page.getByTestId('header-mobile-tools-btn').click()
      await expect(
        page.getByTestId('header-mobile-lock-vault-btn'),
      ).toBeVisible()
      await expect(
        page.getByTestId('header-mobile-lock-vault-btn'),
      ).toBeEnabled()
      await expect(page.getByTestId('header-identities-btn')).toHaveCount(0)
      await page.keyboard.press('Escape')
      await page.setViewportSize({ width: 1280, height: 720 })

      await page.getByTestId('legal-header-back').click()

      await expect(page).toHaveURL(/\/vault$/)
      await expect(page.getByTestId('vault-panel')).toBeVisible()
      await expect(page.getByTestId('header-identities-btn')).toBeVisible()
    }
  })

  test('does not queue header access while an invitation preserves the access gate', async ({
    page,
  }) => {
    await connectLocalVault(page)
    const invitation = await signedSentinelInvitation()

    await page.evaluate((request) => {
      history.pushState(
        {},
        '',
        `/vault#sentinel-request=${encodeURIComponent(request)}`,
      )
      window.dispatchEvent(new PopStateEvent('popstate'))
    }, invitation)

    await expect(
      page.getByTestId('sentinel-genesis-participant-step'),
    ).toBeVisible({ timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS })
    await expect(page.getByTestId('header-identities-btn')).toHaveCount(0)
    await expect(page.getByTestId('header-lock-vault-btn')).toBeVisible()
    await expect(page.getByTestId('header-lock-vault-btn')).toBeEnabled()

    await page.setViewportSize({ width: 320, height: 780 })
    await expect(page.getByTestId('header-mobile-tools-btn')).toBeVisible()
    await page.getByTestId('header-mobile-tools-btn').click()
    await expect(page.getByTestId('header-mobile-lock-vault-btn')).toBeVisible()
    await expect(page.getByTestId('header-mobile-lock-vault-btn')).toBeEnabled()
    await expect(page.getByTestId('header-identities-btn')).toHaveCount(0)
    await page.keyboard.press('Escape')

    await page.evaluate(() => {
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    await expect(page).toHaveURL(/\/vault$/)
    await expect(page.getByTestId('vault-panel')).toBeVisible()
    await expect(page.getByTestId('header-identities-btn')).toBeVisible()
    await expect(page.getByTestId('identity-keys')).toHaveCount(0)
  })

  test('returns from management to the page it was opened from', async ({
    page,
  }) => {
    await connectLocalVault(page)

    await page.getByTestId('vault-import-btn').click()
    await expect(page).toHaveURL(/\/vault\/import$/)
    await page.getByTestId('page-bar-back').click()
    await expect(page).toHaveURL(/\/vault$/)
    await expect(page.getByTestId('vault-panel')).toBeVisible()

    await page.getByTestId('header-identities-btn').click()
    await page.getByTestId('identity-manage').first().click()
    await page.getByTestId('identity-menu-details').click()
    await expect(page).toHaveURL(/\/identity$/)
    await expect(page.getByTestId('identity-overview')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await page.getByTestId('identity-page-back').click()
    await expect(page).toHaveURL(/\/identities$/)
    await expect(page.getByTestId('identities-hub')).toBeVisible()
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

    await openKeysPage(page)
    await expect(page.getByTestId('identity-keys')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await page.getByTestId('identity-page-back').click()
    await openVaultPage(page)

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

    await expect(page.getByTestId('add-device-page')).toBeVisible({
      timeout: ENROLLMENT_UNLOCK_TIMEOUT_MS,
    })
    await expect(page).toHaveURL(/\/identity\/devices\/add$/)
    expect(new URL(page.url()).search).toBe('')
    expect(new URL(page.url()).hash).toBe('')

    await openVaultPage(page)
    await expect(page.getByTestId('vault-panel')).toBeVisible()
    await expect(page).toHaveURL(/\/vault$/)
  })
})
