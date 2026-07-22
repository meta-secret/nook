import { expect, test } from '@playwright/test'
import { launchPairedPinExtension } from './helpers/paired-pin-extension'
import { signInAndSaveMockLogin } from './helpers/mock-auth-login'
import { startMockAuthServer } from './mock-auth'

test.describe('PIN Pilot generate password', () => {
  test.describe.configure({ timeout: 180_000 })

  test('generates and fills signup new-password fields', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

    const mockAuth = await startMockAuthServer()
    const paired = await launchPairedPinExtension(testInfo, {
      vaultName: 'Mock auth generate-signup vault',
    })
    try {
      const signupPage = await paired.context.newPage()
      await signupPage.goto(`${mockAuth.origin}/signup`)
      const widget = signupPage.locator('#nook-auth-widget')
      await expect(widget.getByText('Signup detected')).toBeVisible()
      await widget.getByRole('button', { name: 'Generate password' }).click()
      await expect(
        widget.getByText(/new password is filled|пароль заполнен/i),
      ).toBeVisible({ timeout: 20_000 })

      const password = await signupPage
        .locator('input[name="password"]')
        .inputValue()
      const confirm = await signupPage
        .locator('input[name="password-confirm"]')
        .inputValue()
      expect(password.length).toBeGreaterThanOrEqual(16)
      expect(confirm).toBe(password)

      await signupPage.locator('input[name="email"]').fill('gen@nook.test')
      await signupPage.getByRole('button', { name: 'Create account' }).click()
      await expect(signupPage.getByTestId('mock-auth-success')).toHaveText(
        'Authentication complete',
        { timeout: 20_000 },
      )
      await expect(widget.getByText('Save this login?')).toBeVisible({
        timeout: 15_000,
      })
    } finally {
      await paired.context.close()
      await mockAuth.close()
    }
  })

  test('generates password-change replacement and offers update after evidence', async ({
    browserName,
  }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Chrome extensions require Chromium')

    const mockAuth = await startMockAuthServer()
    const paired = await launchPairedPinExtension(testInfo, {
      vaultName: 'Mock auth generate-change vault',
    })
    try {
      const loginPage = await paired.context.newPage()
      await signInAndSaveMockLogin(loginPage, mockAuth.origin)

      const changePage = await paired.context.newPage()
      await changePage.goto(`${mockAuth.origin}/password-change`)
      const widget = changePage.locator('#nook-auth-widget')
      await expect(widget.getByText('Password change detected')).toBeVisible()
      await widget.getByRole('button', { name: 'Generate password' }).click()
      await expect(
        widget.getByText(/new password is filled|пароль заполнен/i),
      ).toBeVisible({ timeout: 20_000 })

      await expect(
        changePage.locator('input[name="current-password"]'),
      ).toHaveValue('')
      const next = await changePage
        .locator('input[name="new-password"]')
        .inputValue()
      const confirm = await changePage
        .locator('input[name="new-password-confirm"]')
        .inputValue()
      expect(next.length).toBeGreaterThanOrEqual(16)
      expect(confirm).toBe(next)

      await changePage.locator('input[name="email"]').fill('alice@nook.test')
      await changePage
        .locator('input[name="current-password"]')
        .fill('extension-fill-password')
      await changePage.getByRole('button', { name: 'Update password' }).click()
      await expect(changePage.getByTestId('mock-auth-success')).toHaveText(
        'Authentication complete',
        { timeout: 20_000 },
      )
      await expect(widget.getByText('Update this login?')).toBeVisible({
        timeout: 15_000,
      })
      await widget.getByTestId('nook-auth-gate-save').click()
      await expect(widget.getByText('Login saved')).toBeVisible()
    } finally {
      await paired.context.close()
      await mockAuth.close()
    }
  })
})
