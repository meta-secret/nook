import { expect, test } from '@playwright/test'
import { waitForEngine } from './helpers'

test.describe('setup connect flow', () => {
  test('connects local vault and shows success', async ({ page }) => {
    await page.goto('/')

    const connectButton = await waitForEngine(page)
    await connectButton.click()

    await expect(page.getByTestId('connect-success')).toContainText(
      'Local vault loaded',
      { timeout: 20_000 },
    )
    await expect(page.getByTestId('connected-badge')).toBeVisible()
  })

  test('shows error when github mode has no pat', async ({ page }) => {
    await page.goto('/')

    const connectButton = await waitForEngine(page)
    await page.getByRole('button', { name: /^GitHub/ }).click()
    await connectButton.click()

    await expect(page.getByTestId('connect-error')).toContainText(
      'Enter a GitHub personal access token',
    )
  })

  test('connect button stays clickable while engine loads', async ({ page }) => {
    await page.goto('/')

    const connectButton = page.getByTestId('connect-vault-btn')
    await expect(connectButton).toBeVisible()
    await connectButton.click({ force: true })

    await expect(
      page.getByTestId('connect-error').or(page.getByTestId('connect-success')),
    ).toBeVisible({ timeout: 20_000 })
  })

  test('locked vault prompts user to open setup', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('nav-vault').click()

    await expect(page.getByTestId('vault-locked')).toBeVisible()
    await page.getByTestId('go-to-setup-btn').click()
    await expect(page.getByTestId('connect-vault-btn')).toBeVisible()
  })
})
