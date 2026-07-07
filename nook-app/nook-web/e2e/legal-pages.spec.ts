import { expect, test } from './fixtures'

test.describe('legal pages', () => {
  test('renders privacy policy at /privacy', async ({ page }) => {
    await page.goto('/privacy')
    await expect(page.getByTestId('legal-document-page')).toHaveAttribute(
      'data-legal-page',
      'privacy',
    )
    await expect(page.getByTestId('legal-document-body')).toContainText(
      'zero-knowledge',
    )
    await expect(page).toHaveTitle(/Privacy Policy · Nook/)
  })

  test('renders terms at /terms and links between documents', async ({
    page,
  }) => {
    await page.goto('/terms')
    await expect(page.getByTestId('legal-document-body')).toContainText('as is')
    await page.getByTestId('legal-document-related-link').click()
    await expect(page.getByTestId('legal-document-page')).toHaveAttribute(
      'data-legal-page',
      'privacy',
    )
  })

  test('shows footer links on the home page', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('product-intro')).toBeVisible()
    await expect(page.getByTestId('footer-about-link')).toHaveAttribute(
      'href',
      '/about.html',
    )
    await expect(page.getByTestId('footer-privacy-link')).toHaveAttribute(
      'href',
      '/privacy',
    )
    await expect(page.getByTestId('footer-terms-link')).toHaveAttribute(
      'href',
      '/terms',
    )
  })

  test('serves static public about page without the app bundle', async ({
    page,
  }) => {
    await page.goto('/about.html')
    await expect(page.locator('h1')).toHaveText('Nook')
    await expect(page.locator('body')).toContainText(
      'client-side password and secrets manager',
    )
    await expect(page.locator('#app')).toHaveCount(0)
  })

  test('returns to home from legal page back button', async ({ page }) => {
    await page.goto('/privacy')
    await page.getByTestId('legal-document-back-btn').click()
    await expect(page.getByTestId('legal-document-page')).not.toBeVisible()
    await expect(page).toHaveURL('/')
  })
})
