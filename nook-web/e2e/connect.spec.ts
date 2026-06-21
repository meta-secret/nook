import { expect, test } from '@playwright/test'

async function waitForConnectButton(page: import('@playwright/test').Page) {
  const button = page.getByTestId('connect-vault-btn')
  await expect(button).toBeVisible()
  await expect(button).not.toContainText('Loading engine', { timeout: 20_000 })
  return button
}

test.describe('vault connect flow', () => {
  test('connects local vault and shows success', async ({ page }) => {
    await page.goto('/')

    const connectButton = await waitForConnectButton(page)
    await connectButton.click()

    await expect(page.getByTestId('connect-success')).toContainText(
      'Local vault loaded',
      { timeout: 20_000 },
    )
    await expect(page.getByTestId('connected-badge')).toBeVisible()
  })

  test('shows error when github mode has no pat', async ({ page }) => {
    await page.goto('/')

    const connectButton = await waitForConnectButton(page)
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
})
