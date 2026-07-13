import { expect, test } from './fixtures'

test.describe('legal pages', () => {
  test('serves static privacy policy at /privacy.html', async ({ page }) => {
    await page.goto('/privacy.html')
    await expect(page.locator('h1')).toHaveText('Privacy Policy')
    await expect(page.locator('body')).toContainText('zero-knowledge')
    await expect(page.locator('#app')).toHaveCount(0)
    await expect(page).toHaveTitle(/Nook Privacy Policy/)
  })

  test('serves static terms at /terms.html and links between documents', async ({
    page,
  }) => {
    await page.goto('/terms.html')
    await expect(page.locator('h1')).toHaveText('Terms of Service')
    await expect(page.locator('body')).toContainText('as is')
    await page.locator('header a[href="/privacy.html"]').click()
    await expect(page.locator('h1')).toHaveText('Privacy Policy')
  })

  test('shows public links in the vault app footer', async ({ page }) => {
    await page.goto('/app/')
    // Empty-device create uses the landing handoff (no ProductIntro panel).
    await expect(page.getByTestId('login-create-vault-chooser')).toBeVisible()
    await expect(page.getByTestId('footer-about-link')).toHaveAttribute(
      'href',
      '/',
    )
    await expect(page.getByTestId('footer-privacy-link')).toHaveAttribute(
      'href',
      '/privacy.html',
    )
    await expect(page.getByTestId('footer-terms-link')).toHaveAttribute(
      'href',
      '/terms.html',
    )
  })

  test('serves the public landing page at the site root', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('h1')).toHaveText('Keys,not accounts.')
    await expect(page).toHaveTitle('Nook — Keys, not accounts')
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      'https://nokey.sh/',
    )
    const structuredData = await page
      .locator('script[type="application/ld+json"]')
      .textContent()
    expect(JSON.parse(structuredData ?? '{}')).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: 'Nook',
      url: 'https://nokey.sh/',
    })
    await expect(page.getByTestId('hero-cta-primary')).toHaveAttribute(
      'href',
      '/app/',
    )
    await expect(page.getByTestId('hero-cta-secondary')).toHaveAttribute(
      'href',
      '#architecture',
    )
    await expect(page.locator('#architecture')).toHaveCount(1)
    await expect(page.locator('#app')).toHaveCount(0)
    await expect(page.getByTestId('landing-theme-toggle')).toBeVisible()
  })

  test('uses the system theme until the visitor chooses one', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      if (sessionStorage.getItem('landing-theme-test-initialized')) return
      localStorage.removeItem('nook_color_mode')
      sessionStorage.setItem('landing-theme-test-initialized', 'true')
    })
    await page.emulateMedia({ colorScheme: 'light' })
    await page.goto('/')

    const root = page.locator('html')
    const toggle = page.getByTestId('landing-theme-toggle')
    await expect(root).toHaveAttribute('data-theme', 'light')
    await expect(toggle).toHaveAttribute('aria-label', /dark/i)

    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(root).toHaveAttribute('data-theme', 'dark')
    await expect(toggle).toHaveAttribute('aria-label', /light/i)

    await toggle.click()
    await expect(root).toHaveAttribute('data-theme', 'light')
    await page.emulateMedia({ colorScheme: 'light' })
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(root).toHaveAttribute('data-theme', 'light')
    await page.reload()
    await expect(root).toHaveAttribute('data-theme', 'light')
  })

  test('localizes the landing page without translating protocol names', async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem('nook_locale', 'ru'))
    await page.goto('/')

    await expect(page.locator('html')).toHaveAttribute('lang', 'ru')
    await expect(page.locator('h1')).toHaveText('Ключи,не аккаунты.')
    await expect(page).toHaveTitle('Nook — Ключи, не аккаунты')
    await expect(page.locator('.lead')).toContainText(
      'Nook — passwordless, local-first',
    )
    await expect(
      page.getByRole('button', { name: 'Shamir Secret Sharing', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', {
        name: 'AES-256-GCM authenticated encryption',
        exact: true,
      }),
    ).toBeVisible()

    const shamir = page.getByRole('button', {
      name: 'Shamir Secret Sharing',
      exact: true,
    })
    await shamir.hover()
    await expect(page.locator('.readout-title')).toHaveText(
      'Shamir Secret Sharing',
    )
    await expect(page.locator('.readout-detail')).toContainText(
      'Shamir Secret Sharing лежит в основе',
    )

    await page.getByRole('button', { name: 'English' }).click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.locator('h1')).toHaveText('Keys,not accounts.')
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('nook_locale')))
      .toBe('en')
  })

  test('keeps the mobile capsule clear of the hero actions', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 575, height: 760 })
    await page.goto('/')

    const actionsBox = await page.locator('.actions').boundingBox()
    const stageBox = await page.locator('.capsule-stage').boundingBox()
    const orbitBox = await page.locator('.orbit').boundingBox()
    if (!actionsBox || !stageBox || !orbitBox) {
      throw new Error('Expected the hero actions, capsule stage, and orbit')
    }

    const actionBottom = actionsBox.y + actionsBox.height
    const orbitBottom = orbitBox.y + orbitBox.height
    const stageBottom = stageBox.y + stageBox.height
    expect(orbitBox.y - actionBottom).toBeGreaterThanOrEqual(16)
    expect(stageBottom - orbitBottom).toBeGreaterThanOrEqual(0)
  })

  test('serves static public about page without the app bundle', async ({
    page,
  }) => {
    await page.goto('/about.html')
    await expect(page.locator('h1')).toHaveText('Keys,not accounts.')
    await expect(page.locator('body')).toContainText(
      'passwordless, local first, decentralized secrets manager',
    )
    await expect(page.locator('body')).toContainText(
      'SLIP-0039 mnemonic shares',
    )
    await expect(page.locator('body')).toContainText('ENCRYPTED_MESH')
    await expect(
      page.getByText('Encrypted storage', { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText('Distributed authority', { exact: true }),
    ).toBeVisible()
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      'https://nokey.sh/',
    )
    await expect(page.locator('#app')).toHaveCount(0)
  })

  test('exposes an interactive cryptographic inventory', async ({ page }) => {
    await page.goto('/')

    const terms = page.locator('.crypto-term')
    await expect(terms).toHaveCount(17)

    const hkdf = page.getByRole('button', {
      name: 'HKDF-SHA256',
      exact: true,
    })
    await hkdf.hover()
    await expect(page.locator('.readout-code')).toHaveText(
      'HKDF_SHA256 · DERIVE',
    )
    await expect(page.locator('.readout-title')).toHaveText('HKDF-SHA256')
    await expect(page.locator('.readout-detail')).toContainText(
      'Domain-separated HKDF-SHA256',
    )
    await expect(hkdf).toHaveAttribute('aria-pressed', 'true')

    const diagramLabels = page.locator('.system-label')
    await expect(diagramLabels).toHaveCount(3)
    const labelCodes = (await diagramLabels.allTextContents()).map((code) =>
      code.trim(),
    )
    expect(new Set(labelCodes).size).toBe(3)
    const labelPositions = await diagramLabels.evaluateAll((labels) =>
      labels.map((label) => [
        label.style.getPropertyValue('--signal-x'),
        label.style.getPropertyValue('--signal-y'),
      ]),
    )
    expect(
      new Set(labelPositions.map((position) => position.join(':'))).size,
    ).toBe(3)
    const sectorAssignments = await diagramLabels.evaluateAll((labels) =>
      labels.map((label) => ({
        sector: Number(label.getAttribute('data-sector-index')),
        slot: Number(label.getAttribute('data-slot-index')),
      })),
    )
    const allowedSlots = [
      [0, 3],
      [1, 2, 4],
      [5, 6, 7, 8, 9],
    ]
    for (const { sector, slot } of sectorAssignments) {
      expect(allowedSlots[sector]).toContain(slot)
    }
    for (const detail of await diagramLabels.evaluateAll((labels) =>
      labels.map((label) => label.getAttribute('data-detail')),
    )) {
      expect(detail).toBeTruthy()
    }
    const tooltipWrapping = await diagramLabels.first().evaluate((label) => {
      const style = getComputedStyle(label, '::after')
      return {
        overflowWrap: style.overflowWrap,
        whiteSpace: style.whiteSpace,
      }
    })
    expect(tooltipWrapping).toEqual({
      overflowWrap: 'anywhere',
      whiteSpace: 'normal',
    })

    const principles = page.locator('.capsule-principles li')
    await expect(principles).toHaveCount(2)
    const principlePositions = await principles.evaluateAll((items) =>
      items.map((item) => [
        item.style.getPropertyValue('--principle-x'),
        item.style.getPropertyValue('--principle-y'),
      ]),
    )
    expect(
      new Set(principlePositions.map((position) => position.join(':'))).size,
    ).toBe(2)
    expect(principlePositions.some(([, y]) => Number.parseFloat(y) < 50)).toBe(
      true,
    )

    await expect
      .poll(async () => (await diagramLabels.allTextContents()).join('|'), {
        timeout: 4_000,
      })
      .not.toBe(labelCodes.join('|'))
    await expect
      .poll(() =>
        principles.evaluateAll((items) =>
          items.map((item) => [
            item.style.getPropertyValue('--principle-x'),
            item.style.getPropertyValue('--principle-y'),
          ]),
        ),
      )
      .toEqual(principlePositions)
  })

  test('publishes the canonical crawl configuration', async ({ request }) => {
    const robotsResponse = await request.get('/robots.txt')
    expect(robotsResponse.ok()).toBe(true)
    const robots = await robotsResponse.text()
    expect(robots).toContain('Allow: /$')
    expect(robots).toContain('Disallow: /app/')
    expect(robots).toContain('Sitemap: https://nokey.sh/sitemap.xml')

    const sitemapResponse = await request.get('/sitemap.xml')
    expect(sitemapResponse.ok()).toBe(true)
    const sitemap = await sitemapResponse.text()
    expect(sitemap).toContain('<loc>https://nokey.sh/</loc>')
    expect(sitemap).toContain('<loc>https://nokey.sh/privacy.html</loc>')
    expect(sitemap).toContain('<loc>https://nokey.sh/terms.html</loc>')
    expect(sitemap).not.toContain('/app/</loc>')

    const obsoleteSchemaResponse = await request.get('/schema.xml')
    expect(obsoleteSchemaResponse.status()).toBe(404)
  })

  test('returns to home from static legal page brand link', async ({
    page,
  }) => {
    await page.goto('/privacy.html')
    await page.locator('header a.brand').click()
    await expect(page).toHaveURL('/')
  })
})
