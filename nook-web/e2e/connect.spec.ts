import { expect, test } from '@playwright/test'
import { UI_TIMEOUT_MS, waitForEngine } from './helpers'

test.describe('vault connect flow', () => {
  test('connects local vault and opens vault directly', async ({ page }) => {
    await page.goto('/')

    await page.getByTestId('provider-option-local').click()
    const connectButton = await waitForEngine(page)
    await connectButton.click()

    await expect(
      page.getByTestId('connect-success').or(page.getByTestId('app-success')),
    ).toContainText('Local vault loaded', { timeout: UI_TIMEOUT_MS })
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
    const connectButton = page.getByTestId('connect-provider-btn')
    await expect(connectButton).toBeVisible()
    await connectButton.click({ force: true })

    await expect(
      page.getByTestId('connect-error').or(page.getByTestId('vault-panel')),
    ).toBeVisible({ timeout: UI_TIMEOUT_MS })
  })

  test('shows login gate on first visit', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByTestId('login-gate')).toBeVisible()
    await expect(page.getByTestId('provider-option-local')).toBeVisible()
    await expect(page.getByTestId('provider-option-github')).toBeVisible()
    await expect(page.getByTestId('vault-panel')).not.toBeVisible()
    await expect(page.getByTestId('product-intro')).toBeVisible()
    await expect(page.getByTestId('github-source-link')).toHaveAttribute(
      'href',
      'https://github.com/meta-secret/nook',
    )
  })

  test('opens help page from header', async ({ page }) => {
    await page.goto('/')

    await page.getByTestId('help-open-btn').click()
    await expect(page.getByTestId('help-page')).toBeVisible()
    await expect(page.getByTestId('help-section-decentralized')).toBeVisible()
    await expect(page.getByTestId('help-section-join')).toBeVisible()
    await page.getByTestId('help-close-btn').click()
    await expect(page.getByTestId('login-gate')).toBeVisible()
  })

  test('add provider from storage settings while connected', async ({
    page,
  }) => {
    await page.goto('/')
    await page.getByTestId('provider-option-local').click()
    await (await waitForEngine(page)).click()
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })

    await page.getByTestId('storage-settings-btn').click()
    await expect(page.getByTestId('settings-providers-list')).toBeVisible()
    await page.getByTestId('add-provider-btn').click()
    await expect(page.getByTestId('provider-picker-list')).toBeVisible()
    await page.getByTestId('provider-option-github').click()
    await expect(page.getByTestId('github-token-setup')).toBeVisible()
    await page.getByTestId('cancel-add-provider-btn').click()
    await expect(page.getByTestId('provider-picker-list')).toBeVisible()
    await page.getByTestId('cancel-add-provider-btn').click()
    await expect(page.getByTestId('settings-providers-list')).toBeVisible()
  })

  test('unlock saved local provider without re-setup', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('provider-option-local').click()
    await (await waitForEngine(page)).click()
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })

    await page.reload()
    await expect(page.getByTestId('vault-panel')).toBeVisible({
      timeout: UI_TIMEOUT_MS,
    })
  })
})
