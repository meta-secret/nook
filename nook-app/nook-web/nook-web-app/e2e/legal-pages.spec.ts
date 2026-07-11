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
    await expect(page.getByTestId('product-intro')).toBeVisible()
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
    await expect(page.locator('a.button.primary')).toHaveAttribute(
      'href',
      '/app/',
    )
    await expect(page.locator('#app')).toHaveCount(0)
  })

  test('serves static public about page without the app bundle', async ({
    page,
  }) => {
    await page.goto('/about.html')
    await expect(page.locator('h1')).toHaveText('Keys,not accounts.')
    await expect(page.locator('body')).toContainText(
      'client-side password and secrets manager',
    )
    await expect(page.locator('body')).toContainText('X25519_DEVICE_IDENTITY')
    await expect(page.locator('body')).toContainText('ENCRYPTED_MESH')
    await expect(
      page.getByText('Encrypted storage', { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText('Distributed authority', { exact: true }),
    ).toBeVisible()
    await expect(page.locator('#app')).toHaveCount(0)
  })

  test('returns to home from static legal page brand link', async ({
    page,
  }) => {
    await page.goto('/privacy.html')
    await page.locator('header a.brand').click()
    await expect(page).toHaveURL('/')
  })
})
