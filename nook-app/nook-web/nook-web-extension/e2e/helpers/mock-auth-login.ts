import { expect, type Page } from '@playwright/test'

export async function signInAndSaveMockLogin(
  loginPage: Page,
  origin: string,
): Promise<void> {
  await loginPage.goto(`${origin}/plain/login`)
  await loginPage.locator('input[name="username"]').fill('alice@nook.test')
  await loginPage
    .locator('input[name="password"]')
    .fill('extension-fill-password')
  await loginPage.getByRole('button', { name: 'Sign in' }).click()
  await expect(loginPage.getByTestId('mock-auth-success')).toHaveText(
    'Authentication complete',
    { timeout: 20_000 },
  )
  const widget = loginPage.locator('#nook-auth-widget')
  await expect(widget.getByText('Save this login?')).toBeVisible({
    timeout: 15_000,
  })
  await widget.getByTestId('nook-auth-gate-save').click()
  await expect(widget.getByText('Login saved')).toBeVisible()
}
