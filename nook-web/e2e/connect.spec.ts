import { expect, test } from '@playwright/test'
import { waitForEngine } from './helpers'

test.describe('vault connect flow', () => {
  test('connects local vault and opens vault directly', async ({ page }) => {
    await page.goto('/')

    await page.getByTestId('provider-option-local').click()
    const connectButton = await waitForEngine(page)
    await connectButton.click()

    await expect(
      page.getByTestId('connect-success').or(page.getByTestId('app-success')),
    ).toContainText('Local vault loaded', { timeout: 20_000 })
    await expect(page.getByTestId('vault-panel')).toBeVisible()
    await expect(page.getByTestId('login-gate')).not.toBeVisible()
  })

  test('shows error when github mode has no pat', async ({ page }) => {
    await page.goto('/')

    await page.getByTestId('provider-option-github').click()
    const connectButton = await waitForEngine(page)
    await connectButton.click()

    await expect(page.getByTestId('connect-error')).toContainText(
      'Enter a GitHub personal access token',
    )
  })

  test('connect button stays clickable while engine loads', async ({
    page,
  }) => {
    await page.goto('/')

    await page.getByTestId('provider-option-local').click()
    const connectButton = page.getByTestId('sign-in-btn')
    await expect(connectButton).toBeVisible()
    await connectButton.click({ force: true })

    await expect(
      page.getByTestId('connect-error').or(page.getByTestId('vault-panel')),
    ).toBeVisible({ timeout: 20_000 })
  })

  test('shows login gate on first visit', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByTestId('login-gate')).toBeVisible()
    await expect(page.getByTestId('provider-option-local')).toBeVisible()
    await expect(page.getByTestId('provider-option-github')).toBeVisible()
    await expect(page.getByTestId('vault-panel')).not.toBeVisible()
  })

  test('unlock saved local provider without re-setup', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('provider-option-local').click()
    await (await waitForEngine(page)).click()
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: 20_000,
    })

    await page.reload()
    await expect(page.getByTestId('login-gate')).toBeVisible()
    await expect(page.getByTestId('saved-provider-local')).toBeVisible()
    await page.getByTestId('unlock-vault-btn').click()
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: 20_000,
    })
  })
})
