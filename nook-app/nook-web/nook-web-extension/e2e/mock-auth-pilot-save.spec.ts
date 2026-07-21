import { expect, test } from '@playwright/test'
import { launchPairedPinExtension } from './helpers/paired-pin-extension'
import { startMockAuthServer } from './mock-auth'

test.describe('PIN Pilot save login', () => {
  test.describe.configure({ timeout: 180_000 })

  test('saves a new sign-in and fills it on the next visit', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

    const mockAuth = await startMockAuthServer()
    const paired = await launchPairedPinExtension(testInfo, {
      vaultName: 'Mock auth save-login vault',
    })
    try {
      const loginPage = await paired.context.newPage()
      await loginPage.goto(`${mockAuth.origin}/plain/login`)
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

      const nextLogin = await paired.context.newPage()
      await nextLogin.goto(`${mockAuth.origin}/plain/login`)
      const nextWidget = nextLogin.locator('#nook-auth-widget')
      await expect(nextWidget.getByText('Ready to sign in')).toBeVisible()
      await nextWidget
        .getByRole('button', { name: 'Continue with Nook' })
        .click()
      await expect(nextLogin.getByTestId('mock-auth-success')).toHaveText(
        'Authentication complete',
        { timeout: 20_000 },
      )
    } finally {
      await paired.context.close()
      await mockAuth.close()
    }
  })

  test('saves a signup login and fills it on plain login', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

    const mockAuth = await startMockAuthServer()
    const paired = await launchPairedPinExtension(testInfo, {
      vaultName: 'Mock auth save-signup vault',
    })
    try {
      const signupPage = await paired.context.newPage()
      await signupPage.goto(`${mockAuth.origin}/signup`)
      await expect(
        signupPage.locator('#nook-auth-widget').getByText('Signup detected'),
      ).toBeVisible()
      await signupPage.locator('input[name="email"]').fill('new@nook.test')
      await signupPage
        .locator('input[name="password"]')
        .fill('signup-save-pass')
      await signupPage
        .locator('input[name="password-confirm"]')
        .fill('signup-save-pass')
      await signupPage.getByRole('button', { name: 'Create account' }).click()
      await expect(signupPage.getByTestId('mock-auth-success')).toHaveText(
        'Authentication complete',
        { timeout: 20_000 },
      )

      const widget = signupPage.locator('#nook-auth-widget')
      await expect(widget.getByText('Save this login?')).toBeVisible({
        timeout: 15_000,
      })
      await widget.getByTestId('nook-auth-gate-save').click()
      await expect(widget.getByText('Login saved')).toBeVisible()

      const loginPage = await paired.context.newPage()
      await loginPage.goto(`${mockAuth.origin}/plain/login`)
      const loginWidget = loginPage.locator('#nook-auth-widget')
      await expect(loginWidget.getByText('Ready to sign in')).toBeVisible()
      await loginWidget
        .getByRole('button', { name: 'Continue with Nook' })
        .click()
      await expect(loginPage.getByTestId('mock-auth-success')).toHaveText(
        'Authentication complete',
        { timeout: 20_000 },
      )
    } finally {
      await paired.context.close()
      await mockAuth.close()
    }
  })
})
