import { expect, test } from '@playwright/test'

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
    await expect(page.getByTestId('footer-privacy-link')).toHaveAttribute(
      'href',
      '/privacy',
    )
    await expect(page.getByTestId('footer-terms-link')).toHaveAttribute(
      'href',
      '/terms',
    )
  })

  test('returns to home from legal page back button', async ({ page }) => {
    await page.goto('/privacy')
    await page.getByTestId('legal-document-back-btn').click()
    await expect(page.getByTestId('legal-document-page')).not.toBeVisible()
    await expect(page).toHaveURL('/')
  })
})
