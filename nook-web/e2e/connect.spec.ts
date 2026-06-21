import { expect, test } from '@playwright/test'
import { waitForEngine } from './helpers'

test.describe('vault connect flow', () => {
  test('connects local vault and opens vault directly', async ({ page }) => {
    await page.goto('/')

    const connectButton = await waitForEngine(page)
    await connectButton.click()

    await expect(page.getByTestId('app-success')).toContainText(
      'Local vault loaded',
      { timeout: 20_000 },
    )
    await expect(page.getByTestId('vault-panel')).toBeVisible()
    await expect(page.getByTestId('vault-welcome')).not.toBeVisible()
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
      page.getByTestId('connect-error').or(page.getByTestId('vault-panel')),
    ).toBeVisible({ timeout: 20_000 })
  })

  test('shows connect form on first visit', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByTestId('vault-welcome')).toBeVisible()
    await expect(page.getByTestId('connect-vault-btn')).toBeVisible()
    await expect(page.getByTestId('vault-panel')).not.toBeVisible()
  })
})
